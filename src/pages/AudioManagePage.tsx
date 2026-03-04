import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Waveform } from '../components/audio';
import { Header, WorkflowNav } from '../components/layout';
import { Badge, Button, Card, EmptyState, ProgressBar, StatusChip } from '../components/ui';
import type { AudioAsset, Project, UsageRecord } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';
import { summarizeProjectProgress } from '../utils/projectHealth';
import { createGeminiTtsUsageRecord } from '../utils/usage';
import {
  parseMarkIndex,
  splitScriptIntoSegments,
} from '../../shared/utils/ttsSegmentation';

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
          return { ...prev, ttsVoice: list[0].name };
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
  const summary = useMemo(() => (project ? summarizeProjectProgress(project) : null), [project]);

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
        : (currentProject.usage ?? []);

      const updatedProject: Project = {
        ...currentProject,
        parts: currentProject.parts.map((p) =>
          p.id === partId ? { ...p, audio, updatedAt: now } : p
        ),
        audio: [...currentProject.audio.filter((a) => a.id !== prevAudioId), audio],
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
            const result = await window.electronAPI.tts.generate(
              part.scriptText,
              ttsOptions,
              projectId
            );
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
        const totalChars = syncSegments.reduce(
          (sum, seg) => sum + seg.replace(/\s+/g, '').length,
          0
        );
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
    const el = container.querySelector(
      `[data-seg-index="${activeSegmentIndex}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeSegmentIndex, showSyncPreview]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">読み込み中...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-red-600">{error || 'プロジェクトが見つかりません'}</p>
          <Button onClick={() => navigate('/projects')}>プロジェクト一覧に戻る</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header
        title="音声"
        subtitle={project.name}
        statusLabel={summary ? `未生成 ${summary.missingAudio}` : undefined}
        statusTone={summary && summary.missingAudio > 0 ? 'warning' : 'success'}
      />

      {projectId && <WorkflowNav projectId={projectId} current="audio" project={project} />}

      {error && (
        <div className="mx-4 mt-4 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="px-4 pt-3">
        <Card
          title="一括音声生成"
          subtitle={`未生成 ${missingAudioCount} / ${project.parts.length}`}
          actions={
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={generateOnlyMissing}
                  onChange={(e) => setGenerateOnlyMissing(e.target.checked)}
                />
                未生成のみ
              </label>
              <Button
                variant="success"
                onClick={handleGenerateAll}
                disabled={isGeneratingAll || project.parts.length === 0}
              >
                {isGeneratingAll ? '一括生成中...' : '全パート生成'}
              </Button>
              {isGeneratingAll && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  キャンセル
                </Button>
              )}
            </div>
          }
        >
          <div className="space-y-2">
            {batchProgress ? (
              <ProgressBar
                value={batchProgress.current}
                max={Math.max(1, batchProgress.total)}
                tone="success"
                label={`進捗 ${batchProgress.current}/${batchProgress.total}`}
              />
            ) : (
              <p className="text-xs text-slate-500">生成待機中</p>
            )}
            <div className="flex items-center gap-2 text-xs">
              <Badge tone="warning">未音声 {summary?.missingAudio ?? 0}</Badge>
              <Badge tone="warning">未画像 {summary?.missingImages ?? 0}</Badge>
              <StatusChip tone="info" label={`パート ${project.parts.length}`} />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px] gap-4 overflow-hidden p-4">
        <Card
          title="パート一覧"
          subtitle={`未生成 ${missingAudioCount}`}
          className="overflow-hidden"
        >
          <ul className="nv-scrollbar max-h-[calc(100vh-300px)] space-y-2 overflow-auto pr-1">
            {project.parts.map((part, index) => (
              <li key={part.id}>
                <button
                  onClick={() => setSelectedPartId(part.id)}
                  className={`w-full rounded-[8px] border px-3 py-2 text-left transition-colors ${
                    selectedPartId === part.id
                      ? 'border-[var(--nv-color-accent)] bg-blue-50'
                      : 'border-[var(--nv-color-border)] bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{index + 1}</span>
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {part.title}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px]">
                    <Badge tone={part.audio ? 'success' : 'warning'}>
                      {part.audio ? '生成済み' : '未生成'}
                    </Badge>
                    {part.audio && <Badge tone="neutral">{part.audio.ttsEngine}</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4 overflow-auto">
          <Card title="音声設定" subtitle="生成設定（TTS）">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  TTSエンジン
                </label>
                <select
                  value={settings.ttsEngine}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      ttsEngine: e.target.value as TTSEngine,
                    }))
                  }
                  className="nv-input"
                  disabled
                >
                  <option value="gemini_tts">gemini-2.5-pro-preview-tts</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">ボイス</label>
                {voices.length > 0 ? (
                  <select
                    value={settings.ttsVoice}
                    onChange={(e) => setSettings((prev) => ({ ...prev, ttsVoice: e.target.value }))}
                    className="nv-input"
                    disabled={isLoadingVoices}
                  >
                    {voices.slice(0, 200).map((v) => (
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
                    className="nv-input"
                  />
                )}
              </div>
            </div>
          </Card>

          {selectedPart ? (
            <Card
              title={selectedPart.title}
              subtitle={selectedPart.summary}
              actions={
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleGenerateForSelected}
                    disabled={isGenerating || isGeneratingAll}
                  >
                    {isGenerating ? '生成中...' : selectedPart.audio ? '再生成' : '生成'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleClearAudio}
                    disabled={!selectedPart.audio || isGenerating || isGeneratingAll}
                  >
                    解除
                  </Button>
                </div>
              }
            >
              <label className="mb-2 block text-xs font-semibold text-slate-600">
                読み上げ原稿
              </label>
              <div className="max-h-64 overflow-auto rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">
                {selectedPart.scriptText}
              </div>
            </Card>
          ) : (
            <EmptyState title="パートを選択してください" />
          )}
        </div>

        <Card title="音声プレビュー" subtitle="波形・同期確認" className="overflow-auto">
          {selectedPart?.audio ? (
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
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showSyncPreview}
                    onChange={(e) => setShowSyncPreview(e.target.checked)}
                  />
                  同期プレビュー
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showWaveform}
                    onChange={(e) => setShowWaveform(e.target.checked)}
                  />
                  波形
                </label>
                {showSyncPreview && (
                  <Badge tone={syncTimepoints ? 'success' : 'neutral'}>
                    {syncTimepoints ? '精密（タイムポイント）' : '推定'}
                  </Badge>
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
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">行クリックで該当位置へシーク</p>
                  <div
                    ref={syncListRef}
                    className="max-h-56 overflow-auto rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50"
                  >
                    {syncSegments.map((seg, idx) => {
                      const active = idx === activeSegmentIndex;
                      return (
                        <button
                          key={idx}
                          type="button"
                          data-seg-index={idx}
                          onClick={() => seekToSegment(idx)}
                          className={`w-full border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                            active ? 'bg-blue-100 text-blue-900' : 'text-slate-700 hover:bg-white'
                          }`}
                        >
                          <span className="mr-2 inline-block w-7 text-right text-xs text-slate-400">
                            {idx + 1}
                          </span>
                          {seg}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1 text-xs text-slate-600">
                <div>エンジン: {selectedPart.audio.ttsEngine}</div>
                <div>ボイス: {selectedPart.audio.voiceId}</div>
                <div>推定長: {selectedPart.audio.durationSec}s</div>
                <div className="break-all text-[11px] text-slate-500">
                  {selectedPart.audio.filePath}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title="まだ音声が生成されていません" />
          )}
        </Card>
      </div>
    </div>
  );
}
