import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Waveform } from '../components/audio';
import { Header, WorkflowNav } from '../components/layout';
import type { AudioAsset, Project, UsageRecord } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';
import { createGeminiTtsUsageRecord } from '../utils/usage';

type TTSEngine = 'google_tts' | 'gemini_tts' | 'macos_tts';

interface VoiceInfo {
  name: string;
  languageCodes: string[];
  gender: 'MALE' | 'FEMALE' | 'NEUTRAL';
  sampleRateHertz: number;
}

interface Settings {
  ttsEngine: TTSEngine;
  ttsVoice: string;
  ttsSpeakingRate: number;
  ttsPitch: number;
}

const defaultSettings: Settings = {
  ttsEngine: 'gemini_tts',
  ttsVoice: 'Charon',
  ttsSpeakingRate: 1.0,
  ttsPitch: 0,
};

function guessLanguageCode(voiceName: string): string {
  const match = voiceName.match(/^([a-z]{2}-[A-Z]{2})/);
  return match?.[1] || 'ja-JP';
}

function splitScriptIntoSegments(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const segments: string[] = [];
  let buffer = '';

  const flush = () => {
    const seg = buffer.replace(/\n+/g, ' ').trim();
    buffer = '';
    if (seg) segments.push(seg);
  };

  for (const ch of normalized) {
    buffer += ch;
    if (ch === '\n') {
      flush();
      continue;
    }
    if ('。！？!?'.includes(ch)) {
      flush();
      continue;
    }
    if (ch === '、' && buffer.length >= 40) {
      flush();
      continue;
    }
    if (buffer.length >= 80) {
      flush();
    }
  }
  flush();

  return segments;
}

function parseMarkIndex(markName: string): number | null {
  const match = markName.match(/^m(\d+)$/);
  if (!match) return null;
  const idx = Number(match[1]);
  return Number.isFinite(idx) ? idx : null;
}

export function AudioManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const projectRef = useRef<Project | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [showSyncPreview, setShowSyncPreview] = useState(true);
  const [showWaveform, setShowWaveform] = useState(true);
  const [playbackTimeSec, setPlaybackTimeSec] = useState(0);
  const [audioDurationSec, setAudioDurationSec] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [generateOnlyMissing, setGenerateOnlyMissing] = useState(true);
  const cancelRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // プロジェクト & 設定の読み込み
  useEffect(() => {
    const load = async () => {
      if (!projectId) return;

      try {
        setIsLoading(true);
        setError(null);

        const [loadedProject, loadedSettings] = await Promise.all([
          window.electronAPI.project.load(projectId),
          window.electronAPI.settings.get(),
        ]);

        setProject(loadedProject);
        setSettings({
          ...defaultSettings,
          ...loadedSettings,
        });

        if (loadedProject.parts.length > 0) {
          setSelectedPartId(loadedProject.parts[0].id);
        }
      } catch (err) {
        console.error('Failed to load project/settings:', err);
        setError(err instanceof Error ? err.message : '読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [projectId]);

  // 音声ボイス一覧の読み込み
  useEffect(() => {
    const loadVoices = async () => {
      setIsLoadingVoices(true);
      try {
        const list = await window.electronAPI.tts.getVoices(settings.ttsEngine);
        setVoices(list);
        setSettings((prev) => {
          if (list.length === 0) return prev;
          if (list.some((v) => v.name === prev.ttsVoice)) return prev;
          const preferred =
            prev.ttsEngine === 'google_tts'
              ? list.find((v) => v.languageCodes.some((lc) => lc.startsWith('ja'))) || list[0]
              : list[0];
          return { ...prev, ttsVoice: preferred.name };
        });
      } catch (err) {
        console.warn('Failed to load voices:', err);
        setVoices([]);
      } finally {
        setIsLoadingVoices(false);
      }
    };

    loadVoices();
  }, [settings.ttsEngine]);

  const selectedPart = useMemo(() => {
    return project?.parts.find((p) => p.id === selectedPartId) || null;
  }, [project, selectedPartId]);

  useEffect(() => {
    setPlaybackTimeSec(0);
    setAudioDurationSec(null);
  }, [selectedPartId]);

  const missingAudioCount = useMemo(() => {
    if (!project) return 0;
    return project.parts.filter((p) => !p.audio).length;
  }, [project]);

  const ttsOptions = useMemo(() => {
    return {
      ttsEngine: settings.ttsEngine,
      voiceName: settings.ttsVoice,
      languageCode: guessLanguageCode(settings.ttsVoice),
      speakingRate: settings.ttsSpeakingRate,
      pitch: settings.ttsPitch,
      audioEncoding: 'MP3' as const,
    };
  }, [settings]);

  const saveProject = useCallback(async (updated: Project) => {
    await window.electronAPI.project.save(updated);
    projectRef.current = updated;
    setProject(updated);
  }, []);

  const applyAudioToPart = useCallback(
    async (partId: string, audio: AudioAsset, usageRecord?: UsageRecord | null) => {
      const currentProject = projectRef.current;
      if (!currentProject) return;

      const now = new Date().toISOString();
      const targetPart = currentProject.parts.find((p) => p.id === partId);
      const prevAudioId = targetPart?.audio?.id;
      const nextUsage = usageRecord
        ? [...(currentProject.usage ?? []), usageRecord]
        : currentProject.usage ?? [];

      const updatedProject: Project = {
        ...currentProject,
        parts: currentProject.parts.map((p) =>
          p.id === partId ? { ...p, audio, updatedAt: now } : p
        ),
        audio: [
          ...currentProject.audio.filter((a) => a.id !== prevAudioId),
          audio,
        ],
        usage: nextUsage,
        updatedAt: now,
      };

      await saveProject(updatedProject);
    },
    [saveProject]
  );

  const handleGenerateForSelected = useCallback(async () => {
    if (!projectId || !selectedPart) return;

    try {
      setIsGenerating(true);
      setError(null);

      const result = await window.electronAPI.tts.generate(
        selectedPart.scriptText,
        ttsOptions,
        projectId
      );
      const usageRecord = createGeminiTtsUsageRecord('tts_generate', result.usage);
      await applyAudioToPart(selectedPart.id, result.audio, usageRecord);
    } catch (err) {
      console.error('Failed to generate audio:', err);
      setError(err instanceof Error ? err.message : '音声生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  }, [applyAudioToPart, projectId, selectedPart, ttsOptions]);

  const handleClearAudio = useCallback(async () => {
    if (!project || !selectedPart) return;
    if (!selectedPart.audio) return;

    if (!confirm('このパートの音声の紐付けを解除しますか？（ファイルは削除しません）')) return;

    try {
      const now = new Date().toISOString();
      const removedId = selectedPart.audio.id;

      const updatedProject: Project = {
        ...project,
        parts: project.parts.map((p) =>
          p.id === selectedPart.id ? { ...p, audio: undefined, updatedAt: now } : p
        ),
        audio: project.audio.filter((a) => a.id !== removedId),
        updatedAt: now,
      };

      await saveProject(updatedProject);
    } catch (err) {
      console.error('Failed to clear audio:', err);
      setError(err instanceof Error ? err.message : '音声の解除に失敗しました');
    }
  }, [project, saveProject, selectedPart]);

  const handleGenerateAll = useCallback(async () => {
    if (!projectId || !project) return;
    if (project.parts.length === 0) return;

    const targets = generateOnlyMissing
      ? project.parts.filter((p) => !p.audio && p.scriptText.trim())
      : project.parts.filter((p) => p.scriptText.trim());

    if (targets.length === 0) {
      setError('生成対象のパートがありません');
      return;
    }

    try {
      cancelRef.current = false;
      setIsGeneratingAll(true);
      setError(null);
      setBatchProgress({ current: 0, total: targets.length });

      const errors: string[] = [];
      let completed = 0;
      let saveChain: Promise<void> = Promise.resolve();

      await Promise.all(
        targets.map(async (part) => {
          if (cancelRef.current) return;

          try {
            const result = await window.electronAPI.tts.generate(part.scriptText, ttsOptions, projectId);
            const usageRecord = createGeminiTtsUsageRecord('tts_generate', result.usage);
            // 保存は競合しやすいので直列化（ただし生成自体は無制限に並列）
            saveChain = saveChain.then(() => applyAudioToPart(part.id, result.audio, usageRecord));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`${part.index + 1}: ${message}`);
          } finally {
            completed += 1;
            setBatchProgress({ current: completed, total: targets.length });
          }
        })
      );

      await saveChain;

      if (cancelRef.current) {
        setError('キャンセルしました');
      } else if (errors.length > 0) {
        const head = errors.slice(0, 3).join(' / ');
        const tail = errors.length > 3 ? `（他${errors.length - 3}件）` : '';
        setError(`一部の音声生成に失敗しました: ${head}${tail}`);
      }
    } catch (err) {
      console.error('Failed to generate batch audio:', err);
      setError(err instanceof Error ? err.message : '一括音声生成に失敗しました');
    } finally {
      setBatchProgress(null);
      setIsGeneratingAll(false);
      cancelRef.current = false;
    }
  }, [applyAudioToPart, generateOnlyMissing, project, projectId, ttsOptions]);

  const syncSegments = useMemo(() => {
    if (!selectedPart) return [];
    const stored = selectedPart.audio?.segments;
    if (Array.isArray(stored) && stored.length > 0) return stored;
    return splitScriptIntoSegments(selectedPart.scriptText);
  }, [selectedPart]);

  const syncTimepoints = useMemo(() => {
    const tps = selectedPart?.audio?.timepoints;
    if (!Array.isArray(tps) || tps.length === 0) return null;

    return tps
      .map((tp) => ({
        index: parseMarkIndex(tp.markName),
        timeSeconds: tp.timeSeconds,
      }))
      .filter(
        (tp): tp is { index: number; timeSeconds: number } =>
          typeof tp.index === 'number' && Number.isFinite(tp.timeSeconds) && tp.timeSeconds >= 0
      )
      .sort((a, b) => a.timeSeconds - b.timeSeconds);
  }, [selectedPart?.audio?.timepoints]);

  const activeSegmentIndex = useMemo(() => {
    if (!showSyncPreview) return null;
    if (!selectedPart?.audio) return null;
    if (syncSegments.length === 0) return null;

    const t = playbackTimeSec;
    if (!Number.isFinite(t) || t < 0) return null;

    if (syncTimepoints && syncTimepoints.length > 0) {
      let active = 0;
      for (const tp of syncTimepoints) {
        if (t >= tp.timeSeconds) active = tp.index;
        else break;
      }
      return Math.max(0, Math.min(syncSegments.length - 1, active));
    }

    const duration = audioDurationSec ?? selectedPart.audio.durationSec;
    if (!Number.isFinite(duration) || duration <= 0) return null;

    const totalChars = syncSegments.reduce((sum, seg) => sum + seg.replace(/\s+/g, '').length, 0);
    if (totalChars <= 0) return null;

    const target = Math.max(0, Math.min(1, t / duration)) * totalChars;
    let acc = 0;
    for (let i = 0; i < syncSegments.length; i++) {
      acc += syncSegments[i].replace(/\s+/g, '').length;
      if (acc >= target) return i;
    }
    return syncSegments.length - 1;
  }, [
    audioDurationSec,
    playbackTimeSec,
    selectedPart?.audio,
    showSyncPreview,
    syncSegments,
    syncTimepoints,
  ]);

  const seekToSegment = useCallback(
    (index: number) => {
      const audioEl = audioRef.current;
      if (!audioEl || !selectedPart?.audio) return;
      if (syncSegments.length === 0) return;

      const duration = audioDurationSec ?? selectedPart.audio.durationSec;
      let targetTime = 0;

      if (syncTimepoints && syncTimepoints.length > 0) {
        const hit = syncTimepoints.find((tp) => tp.index === index);
        if (hit) targetTime = hit.timeSeconds;
      } else if (Number.isFinite(duration) && duration > 0) {
        const totalChars = syncSegments.reduce((sum, seg) => sum + seg.replace(/\s+/g, '').length, 0);
        const beforeChars = syncSegments
          .slice(0, index)
          .reduce((sum, seg) => sum + seg.replace(/\s+/g, '').length, 0);
        const ratio = totalChars > 0 ? beforeChars / totalChars : 0;
        targetTime = ratio * duration;
      }

      audioEl.currentTime = Math.max(0, targetTime);
    },
    [audioDurationSec, selectedPart?.audio, syncSegments, syncTimepoints]
  );

  useEffect(() => {
    if (!showSyncPreview) return;
    if (activeSegmentIndex === null) return;
    const container = syncListRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-seg-index="${activeSegmentIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeSegmentIndex, showSyncPreview]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'プロジェクトが見つかりません'}</p>
          <button
            onClick={() => navigate('/projects')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            プロジェクト一覧に戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="音声"
        subtitle={project.name}
      />

      {projectId && <WorkflowNav projectId={projectId} current="audio" project={project} />}

      {error && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 左サイドバー: パートリスト */}
        <div className="w-64 border-r border-gray-200 overflow-auto bg-gray-50">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-2">パート一覧</h3>
            <p className="text-xs text-gray-500 mb-4">
              未生成: {missingAudioCount} / {project.parts.length}
            </p>

            <ul className="space-y-2">
              {project.parts.map((part, index) => (
                <li key={part.id}>
                  <button
                    onClick={() => setSelectedPartId(part.id)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedPartId === part.id
                        ? 'bg-white shadow border border-blue-200'
                        : 'hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-400">{index + 1}</span>
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {part.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${part.audio ? 'text-green-600' : 'text-orange-600'}`}>
                        {part.audio ? '✓ 生成済み' : '⚠ 未生成'}
                      </span>
                      {part.audio && (
                        <span className="text-xs text-gray-400 truncate">
                          {part.audio.ttsEngine}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-6 space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={generateOnlyMissing}
                  onChange={(e) => setGenerateOnlyMissing(e.target.checked)}
                />
                未生成のみ一括生成
              </label>

              <button
                onClick={handleGenerateAll}
                disabled={isGeneratingAll || project.parts.length === 0}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGeneratingAll ? '一括生成中...' : '全パートの音声を生成'}
              </button>

              {isGeneratingAll && (
                <button
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                  className="w-full px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100"
                >
                  キャンセル
                </button>
              )}
            </div>
          </div>
        </div>

        {/* メイン */}
        <div className="flex-1 overflow-auto p-6">
          {/* バッチ進捗 */}
          {batchProgress && (
            <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-900">一括音声生成</div>
                <div className="text-sm text-gray-600">
                  {batchProgress.current}/{batchProgress.total}
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (batchProgress.current / Math.max(1, batchProgress.total)) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* 音声設定 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">音声設定</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">TTSエンジン</label>
                <select
                  value={settings.ttsEngine}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      ttsEngine: e.target.value as TTSEngine,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled
                >
                  <option value="gemini_tts">gemini-2.5-pro-preview-tts</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">話速</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={settings.ttsSpeakingRate}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        ttsSpeakingRate: Number(e.target.value),
                      }))
                    }
                    className="flex-1"
                    disabled
                  />
                  <span className="text-sm text-gray-600 w-12 text-right">
                    {settings.ttsSpeakingRate.toFixed(1)}x
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ピッチ</label>
                <input
                  type="number"
                  min={-20}
                  max={20}
                  value={settings.ttsPitch}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      ttsPitch: Number(e.target.value),
                    }))
                  }
                  className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ボイス</label>
                {voices.length > 0 ? (
                  <select
                    value={settings.ttsVoice}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        ttsVoice: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isLoadingVoices}
                  >
                    {voices
                      .filter((v) =>
                        settings.ttsEngine === 'google_tts'
                          ? v.languageCodes.some((lc) => lc.startsWith('ja'))
                          : true
                      )
                      .slice(0, 200)
                      .map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    value={settings.ttsVoice}
                    onChange={(e) => setSettings((prev) => ({ ...prev, ttsVoice: e.target.value }))}
                    placeholder={isLoadingVoices ? '読み込み中...' : 'ボイス名を入力'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Gemini TTS: 設定画面の「Google AI APIキー（AI Studio）」が必要です（話速/ピッチは未対応）
                </p>
              </div>
            </div>
          </div>

          {/* 選択パート */}
          {selectedPart ? (
            <div className="space-y-6">
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {selectedPart.title}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">{selectedPart.summary}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleGenerateForSelected}
                      disabled={isGenerating || isGeneratingAll}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGenerating ? '生成中...' : selectedPart.audio ? '再生成' : 'このパートを生成'}
                    </button>
                    <button
                      onClick={handleClearAudio}
                      disabled={!selectedPart.audio || isGenerating || isGeneratingAll}
                      className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      解除
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    読み上げ原稿
                  </label>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 whitespace-pre-wrap max-h-56 overflow-auto">
                    {selectedPart.scriptText}
                  </div>
                </div>
              </div>

              {/* プレビュー */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">音声プレビュー</h3>

                  {selectedPart.audio ? (
                    <div className="space-y-3">
                      <audio
                        ref={audioRef}
                        controls
                        src={toLocalFileUrl(selectedPart.audio.filePath)}
                        className="w-full"
                        onLoadedMetadata={(e) => {
                          const duration = e.currentTarget.duration;
                          setAudioDurationSec(
                            typeof duration === 'number' && Number.isFinite(duration) ? duration : null
                          );
                          setPlaybackTimeSec(0);
                        }}
                        onDurationChange={(e) => {
                          const duration = e.currentTarget.duration;
                          setAudioDurationSec(
                            typeof duration === 'number' && Number.isFinite(duration) ? duration : null
                          );
                        }}
                        onTimeUpdate={(e) => {
                          const t = e.currentTarget.currentTime;
                          if (typeof t === 'number' && Number.isFinite(t)) setPlaybackTimeSec(t);
                        }}
                      />
                      <div className="flex items-center gap-4 text-sm text-gray-700">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={showSyncPreview}
                            onChange={(e) => setShowSyncPreview(e.target.checked)}
                          />
                          同期プレビュー
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={showWaveform}
                            onChange={(e) => setShowWaveform(e.target.checked)}
                          />
                          波形
                        </label>
                          {showSyncPreview && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                syncTimepoints ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {syncTimepoints ? '精密（タイムポイント）' : '推定'}
                            </span>
                          )}
                        </div>

                        {showWaveform && (
                          <Waveform
                            src={toLocalFileUrl(selectedPart.audio.filePath)}
                            currentTimeSec={playbackTimeSec}
                            durationSec={audioDurationSec ?? selectedPart.audio.durationSec}
                            onSeek={(timeSec) => {
                              if (audioRef.current) audioRef.current.currentTime = timeSec;
                            }}
                          />
                        )}
  
                        {showSyncPreview && syncSegments.length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs text-gray-500 mb-2">
                            行をクリックすると該当位置へシークします。
                          </div>
                          <div
                            ref={syncListRef}
                            className="border border-gray-200 rounded-lg bg-gray-50 max-h-56 overflow-auto"
                          >
                            {syncSegments.map((seg, idx) => {
                              const active = idx === activeSegmentIndex;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  data-seg-index={idx}
                                  onClick={() => seekToSegment(idx)}
                                  className={`w-full text-left px-3 py-2 text-sm border-b last:border-b-0 ${
                                    active
                                      ? 'bg-blue-100 text-blue-900'
                                      : 'hover:bg-white text-gray-700'
                                  }`}
                                >
                                  <span className="inline-block w-7 text-right mr-2 text-xs text-gray-400">
                                    {idx + 1}
                                  </span>
                                  {seg}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div className="text-sm text-gray-700">
                        <div>
                          <span className="text-gray-500">エンジン:</span> {selectedPart.audio.ttsEngine}
                        </div>
                      <div>
                        <span className="text-gray-500">ボイス:</span> {selectedPart.audio.voiceId}
                      </div>
                      <div>
                        <span className="text-gray-500">推定長:</span> {selectedPart.audio.durationSec}s
                      </div>
                      <div className="text-xs text-gray-500 break-all mt-2">
                        {selectedPart.audio.filePath}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">まだ音声が生成されていません</div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-gray-500">パートを選択してください</div>
          )}
        </div>
      </div>
    </div>
  );
}
