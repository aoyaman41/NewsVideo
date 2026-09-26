import { useScrollMemory } from '../hooks/useScrollMemory';
import { useSceneSelection, rememberedScene } from '../stores/sceneSelection';
import { partFreshness } from '../../shared/project/integrity';
import { projectClient, useProjectState } from '../stores/projectStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Waveform } from '../components/audio';
import { Header, WorkflowNav } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Details,
  EmptyState,
  ProgressBar,
  useConfirm,
  useToast,
} from '../components/ui';
import { SceneList } from '../components/common/SceneList';
import { StaleNotice } from '../components/common/StaleNotice';
import { NarrationOverrideNotice } from '../components/common/NarrationOverrideNotice';
import { FriendlyError } from '../components/errors/FriendlyError';
import { ProjectLoadFailure } from '../components/errors/ProjectLoadFailure';
import { useErrorReport } from '../components/errors/useErrorReport';
import { JOB_ACTIVE_MESSAGE, useJobActive } from '../components/common/useJobActive';
import { useProjectCommit } from '../components/common/useProjectCommit';
import { runLimited } from '../components/common/runLimited';
import type { AudioAsset, Part, UsageRecord } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';
import { cx } from '../utils/cx';
import { createGeminiTtsUsageRecord } from '../utils/usage';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  getGeminiTtsModelLabel,
  isGeminiTtsModel,
  type GeminiTtsModel,
} from '../../shared/constants/models';
import {
  TTS_NARRATION_STYLE_DESCRIPTIONS,
  TTS_NARRATION_STYLE_LABELS,
} from '../../shared/project/ttsNarrationStyles';
import { parseMarkIndex, splitScriptIntoSegments } from '../../shared/utils/ttsSegmentation';

type TTSEngine = 'google_tts' | 'gemini_tts' | 'macos_tts';

interface Settings {
  ttsEngine: TTSEngine;
  ttsModel: GeminiTtsModel;
  ttsVoice: string;
  ttsSpeakingRate: number;
  ttsPitch: number;
}

const defaultSettings: Settings = {
  ttsEngine: 'gemini_tts',
  ttsModel: DEFAULT_GEMINI_TTS_MODEL,
  ttsVoice: 'Charon',
  ttsSpeakingRate: 1.0,
  ttsPitch: 0,
};

function guessLanguageCode(voiceName: string): string {
  const match = voiceName.match(/^([a-z]{2}-[A-Z]{2})/);
  return match?.[1] || 'ja-JP';
}

/** 保存された音声を作った仕組みの表示名(音声ごとに異なる。モデル名は保存されていない) */
function audioEngineLabel(engine: TTSEngine): string {
  switch (engine) {
    case 'gemini_tts':
      return 'Gemini';
    case 'google_tts':
      return 'Google Cloud';
    case 'macos_tts':
      return 'macOS の読み上げ';
    default:
      return engine;
  }
}

/** これから音声を作るときに使う仕組みの表示名(設定から) */
function currentVoiceSourceLabel(engine: TTSEngine, model: GeminiTtsModel): string {
  if (engine === 'gemini_tts' && isGeminiTtsModel(model)) return getGeminiTtsModelLabel(model);
  return audioEngineLabel(engine);
}

function formatSeconds(seconds: number): string {
  return `${Math.round(seconds * 10) / 10} 秒`;
}

export function AudioManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();

  const [project, setProject] = useProjectState(projectId);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [selectedPartId, setSelectedPartId] = useSceneSelection(projectId);
  const scrollRef = useScrollMemory(`${projectId}:AudioManagePage`);
  const commit = useProjectCommit(projectId);
  const jobActive = useJobActive(projectId, project);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const {
    reported: error,
    report: reportError,
    reportFailures,
    clear: clearError,
  } = useErrorReport();
  const [busyPartId, setBusyPartId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [regenerateAll, setRegenerateAll] = useState(false);
  const [showWaveform, setShowWaveform] = useState(false);
  const [playbackTimeSec, setPlaybackTimeSec] = useState(0);
  const [audioDurationSec, setAudioDurationSec] = useState<number | null>(null);
  const cancelRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncListRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!projectId) return;
      try {
        setIsLoading(true);
        const [loadedProject, loadedSettings] = await Promise.all([
          projectClient.load(projectId),
          window.electronAPI.settings.get(),
        ]);
        setProject(loadedProject);
        setSettings({ ...defaultSettings, ...loadedSettings });
        if (loadedProject.parts.length > 0) {
          setSelectedPartId(rememberedScene(projectId, loadedProject.parts));
        }
      } catch (err) {
        console.error('Failed to load project/settings:', err);
        setLoadError(err);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [projectId, setProject, setSelectedPartId]);

  const selectedPart = useMemo(
    () => project?.parts.find((p) => p.id === selectedPartId) || null,
    [project, selectedPartId]
  );

  useEffect(() => {
    setPlaybackTimeSec(0);
    setAudioDurationSec(null);
  }, [selectedPartId]);

  const targets = useMemo(() => {
    if (!project) return { parts: [] as Part[], missing: 0, stale: 0 };
    let missing = 0;
    let stale = 0;
    const parts = project.parts.filter((part) => {
      if (!part.scriptText.trim()) return false;
      const state = partFreshness(project, part).audio;
      if (state === 'missing') missing += 1;
      if (state === 'stale') stale += 1;
      return regenerateAll || state !== 'current';
    });
    return { parts, missing, stale };
  }, [project, regenerateAll]);

  const ttsOptions = useMemo(() => {
    const narrationProfile = project?.presentationProfile;
    return {
      ttsEngine: settings.ttsEngine,
      ttsModel: settings.ttsModel,
      voiceName: settings.ttsVoice,
      languageCode: guessLanguageCode(settings.ttsVoice),
      speakingRate: settings.ttsSpeakingRate,
      pitch: settings.ttsPitch,
      audioEncoding: 'MP3' as const,
      narrationStylePreset: narrationProfile?.ttsNarrationStylePreset,
      narrationStyleNote: narrationProfile?.ttsNarrationStyleNote,
    };
  }, [project?.presentationProfile, settings]);

  /**
   * 作った音声をシーンに付ける。作っている間に読み上げる文章が変わっていたら付けない
   * (付けると、違う文章の音声が「最新」と判定されるため)。付けたら true を返す。
   */
  const applyAudio = useCallback(
    async (
      partId: string,
      spokenText: string,
      audio: AudioAsset,
      usageRecord: UsageRecord | null
    ): Promise<boolean> => {
      let applied = false;
      await commit((latest) => {
        const now = new Date().toISOString();
        const usage = usageRecord ? [...(latest.usage ?? []), usageRecord] : (latest.usage ?? []);
        const target = latest.parts.find((p) => p.id === partId);
        if (!target || (target.narrationText || target.scriptText) !== spokenText) {
          return { ...latest, usage, updatedAt: now };
        }
        applied = true;
        const prevAudioId = target.audio?.id;
        return {
          ...latest,
          parts: latest.parts.map((p) => (p.id === partId ? { ...p, audio, updatedAt: now } : p)),
          audio: [...latest.audio.filter((a) => a.id !== prevAudioId), audio],
          usage,
          updatedAt: now,
        };
      });
      return applied;
    },
    [commit]
  );

  const generateFor = useCallback(
    async (part: Part) => {
      if (!projectId) return;
      const spokenText = part.narrationText || part.scriptText;
      const result = await window.electronAPI.tts.generate(spokenText, ttsOptions, projectId);
      const applied = await applyAudio(
        part.id,
        spokenText,
        result.audio,
        createGeminiTtsUsageRecord('tts_generate', result.usage)
      );
      if (!applied) {
        throw new Error(
          '音声を作っている間に台本が変わったため、この音声は使いませんでした。もう一度作ってください。'
        );
      }
    },
    [applyAudio, projectId, ttsOptions]
  );

  const handleGenerateForSelected = useCallback(async () => {
    if (!selectedPart || busyPartId || batchProgress || jobActive) return;
    clearError();
    setBusyPartId(selectedPart.id);
    try {
      await generateFor(selectedPart);
      toast.success('音声を作りました');
    } catch (err) {
      reportError(err, '音声を作れませんでした');
    } finally {
      setBusyPartId(null);
    }
  }, [
    batchProgress,
    busyPartId,
    clearError,
    generateFor,
    jobActive,
    reportError,
    selectedPart,
    toast,
  ]);

  const handleClearAudio = useCallback(async () => {
    if (!selectedPart?.audio) return;
    const accepted = await confirm({
      title: 'このシーンの音声を外しますか?',
      description:
        '音声ファイルは残ります。外したシーンは、書き出しの前に音声を作り直す必要があります。',
      confirmLabel: '外す',
      confirmVariant: 'danger',
    });
    if (!accepted) return;
    const partId = selectedPart.id;
    try {
      await commit((latest) => {
        const now = new Date().toISOString();
        const removedId = latest.parts.find((p) => p.id === partId)?.audio?.id;
        return {
          ...latest,
          parts: latest.parts.map((p) =>
            p.id === partId ? { ...p, audio: undefined, updatedAt: now } : p
          ),
          audio: latest.audio.filter((a) => a.id !== removedId),
          updatedAt: now,
        };
      });
      toast.success('音声を外しました');
    } catch (err) {
      reportError(err, '音声を外せませんでした');
    }
  }, [commit, confirm, reportError, selectedPart, toast]);

  const handleGenerateAll = useCallback(async () => {
    if (!projectId || busyPartId || batchProgress || jobActive) return;
    const list = targets.parts;
    if (list.length === 0) return;
    cancelRef.current = false;
    clearError();
    setBatchProgress({ current: 0, total: list.length });
    const failures: Array<{ label: string; error: unknown }> = [];
    let completed = 0;
    try {
      // 「止める」を押したら、まだ始めていないシーンは作らない(同時に実行する数は Main 側でも制限する)
      await runLimited(list, 8, async (part) => {
        if (cancelRef.current) return;
        try {
          await generateFor(part);
        } catch (err) {
          failures.push({ label: `シーン${part.index + 1}`, error: err });
        } finally {
          completed += 1;
          setBatchProgress({ current: completed, total: list.length });
        }
      });
      if (cancelRef.current) {
        toast.info('まとめて作るのを止めました。できた音声は使われています。', '止めました');
      } else if (failures.length > 0) {
        reportFailures('一部の音声を作れませんでした', failures);
      } else {
        toast.success('音声をまとめて作りました');
      }
    } catch (err) {
      reportError(err, '音声をまとめて作れませんでした');
    } finally {
      setBatchProgress(null);
      cancelRef.current = false;
    }
  }, [
    batchProgress,
    busyPartId,
    clearError,
    generateFor,
    jobActive,
    projectId,
    reportError,
    reportFailures,
    targets.parts,
    toast,
  ]);

  const syncSegments = useMemo(() => {
    if (!selectedPart) return [];
    const stored = selectedPart.audio?.segments;
    if (Array.isArray(stored) && stored.length > 0) return stored;
    return splitScriptIntoSegments(selectedPart.narrationText || selectedPart.scriptText);
  }, [selectedPart]);

  const syncTimepoints = useMemo(() => {
    const tps = selectedPart?.audio?.timepoints;
    if (!Array.isArray(tps) || tps.length === 0) return null;
    return tps
      .map((tp) => ({ index: parseMarkIndex(tp.markName), timeSeconds: tp.timeSeconds }))
      .filter(
        (tp): tp is { index: number; timeSeconds: number } =>
          typeof tp.index === 'number' && Number.isFinite(tp.timeSeconds) && tp.timeSeconds >= 0
      )
      .sort((a, b) => a.timeSeconds - b.timeSeconds);
  }, [selectedPart?.audio?.timepoints]);

  const segmentWeights = useMemo(
    () => syncSegments.map((seg) => seg.replace(/\s+/g, '').length),
    [syncSegments]
  );

  const activeSegmentIndex = useMemo(() => {
    if (!selectedPart?.audio || syncSegments.length === 0) return null;
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
    const totalChars = segmentWeights.reduce((sum, n) => sum + n, 0);
    if (!Number.isFinite(duration) || duration <= 0 || totalChars <= 0) return null;
    const target = Math.max(0, Math.min(1, t / duration)) * totalChars;
    let acc = 0;
    for (let i = 0; i < segmentWeights.length; i++) {
      acc += segmentWeights[i];
      if (acc >= target) return i;
    }
    return syncSegments.length - 1;
  }, [
    audioDurationSec,
    playbackTimeSec,
    segmentWeights,
    selectedPart?.audio,
    syncSegments,
    syncTimepoints,
  ]);

  const seekToSegment = useCallback(
    (index: number) => {
      const audioEl = audioRef.current;
      if (!audioEl || !selectedPart?.audio) return;
      const duration = audioDurationSec ?? selectedPart.audio.durationSec;
      let targetTime = 0;
      const hit = syncTimepoints?.find((tp) => tp.index === index);
      if (hit) {
        targetTime = hit.timeSeconds;
      } else if (Number.isFinite(duration) && duration > 0) {
        const totalChars = segmentWeights.reduce((sum, n) => sum + n, 0);
        const beforeChars = segmentWeights.slice(0, index).reduce((sum, n) => sum + n, 0);
        targetTime = totalChars > 0 ? (beforeChars / totalChars) * duration : 0;
      }
      audioEl.currentTime = Math.max(0, targetTime);
      void audioEl.play().catch(() => {});
    },
    [audioDurationSec, segmentWeights, selectedPart?.audio, syncTimepoints]
  );

  useEffect(() => {
    if (activeSegmentIndex === null) return;
    const el = syncListRef.current?.querySelector(
      `[data-seg-index="${activeSegmentIndex}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeSegmentIndex]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[var(--nv-color-muted)]">読み込み中...</p>
      </div>
    );
  }

  if (!project) {
    return <ProjectLoadFailure error={loadError} onBack={() => navigate('/projects')} />;
  }

  const returnTo = `/projects/${project.id}/audio`;
  const busyHere = Boolean(selectedPart && busyPartId === selectedPart.id);
  const createBlockedReason = jobActive
    ? JOB_ACTIVE_MESSAGE
    : batchProgress
      ? 'まとめて作成中です。終わるまでお待ちください。'
      : busyPartId && !busyHere
        ? 'ほかのシーンの音声を作成中です。'
        : selectedPart && !selectedPart.scriptText.trim()
          ? '台本が空のため、音声を作れません。台本画面で文章を入れてください。'
          : null;
  const batchBlockedReason = jobActive
    ? JOB_ACTIVE_MESSAGE
    : busyPartId
      ? 'シーンの音声を作成中です。終わるまでお待ちください。'
      : targets.parts.length === 0
        ? 'すべてのシーンに最新の音声があります。'
        : null;
  const profile = project.presentationProfile;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="音声" subtitle={project.name} />

      {projectId && <WorkflowNav projectId={projectId} current="audio" project={project} />}

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <SceneList
          className="w-56 shrink-0"
          scenes={project.parts}
          selectedId={selectedPartId}
          onSelect={setSelectedPartId}
          subtitle={`全 ${project.parts.length} シーン`}
          renderStatus={(part) => {
            if (!part.audio) return <Badge tone="warning">音声なし</Badge>;
            const state = partFreshness(project, part).audio;
            return (
              <>
                {state === 'current' && <Badge tone="success">最新</Badge>}
                {state === 'stale' && <Badge tone="warning">古い可能性</Badge>}
                {state === 'missing' && <Badge tone="danger">ファイルなし</Badge>}
                <Badge tone="neutral">{formatSeconds(part.audio.durationSec)}</Badge>
              </>
            );
          }}
        />

        <div
          ref={scrollRef}
          className="@container nv-scrollbar min-h-0 min-w-0 flex-1 space-y-4 overflow-auto pr-1"
        >
          {error && (
            <FriendlyError
              title={error.title}
              explanation={error.explanation}
              onDismiss={clearError}
            />
          )}

          <Card
            title="まとめて作る"
            subtitle={
              targets.missing + targets.stale === 0
                ? 'すべてのシーンに最新の音声があります'
                : `音声がないシーン ${targets.missing} 件・古くなった可能性があるシーン ${targets.stale} 件`
            }
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void handleGenerateAll()}
                disabled={Boolean(batchBlockedReason) || Boolean(batchProgress)}
              >
                {batchProgress
                  ? '作成中…'
                  : regenerateAll
                    ? `すべての音声を作り直す（${targets.parts.length}）`
                    : `足りない音声を作る（${targets.parts.length}）`}
              </Button>
              {batchProgress && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  止める
                </Button>
              )}
              <Checkbox
                checked={regenerateAll}
                onChange={setRegenerateAll}
                disabled={Boolean(batchProgress)}
                label="最新の音声も作り直す"
              />
            </div>
            {!batchProgress && batchBlockedReason && targets.parts.length > 0 && (
              <p className="nv-help mt-2">{batchBlockedReason}</p>
            )}
            {batchProgress && (
              <ProgressBar
                className="mt-3"
                value={batchProgress.current}
                max={Math.max(1, batchProgress.total)}
                tone="success"
                label={`音声を作っています（${batchProgress.current}/${batchProgress.total}）`}
              />
            )}
            <Details
              className="mt-3"
              summary={`声: ${settings.ttsVoice}（${TTS_NARRATION_STYLE_LABELS[profile.ttsNarrationStylePreset]}）`}
            >
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-[var(--nv-color-muted)]">声</dt>
                <dd className="text-[var(--nv-color-text)]">{settings.ttsVoice}</dd>
                <dt className="text-[var(--nv-color-muted)]">音声を作る AI</dt>
                <dd className="text-[var(--nv-color-text)]">
                  {currentVoiceSourceLabel(settings.ttsEngine, settings.ttsModel)}
                </dd>
                <dt className="text-[var(--nv-color-muted)]">話し方</dt>
                <dd className="text-[var(--nv-color-text)]">
                  {TTS_NARRATION_STYLE_LABELS[profile.ttsNarrationStylePreset]}
                  <span className="nv-help block">
                    {TTS_NARRATION_STYLE_DESCRIPTIONS[profile.ttsNarrationStylePreset]}
                  </span>
                  {profile.ttsNarrationStyleNote && (
                    <span className="nv-help block">補足: {profile.ttsNarrationStyleNote}</span>
                  )}
                </dd>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate('/settings', { state: { returnTo } })}
                >
                  設定を開く
                </Button>
                <p className="nv-help">
                  声と読み方の辞書は設定画面、話し方は記事画面で変えられます。
                </p>
              </div>
            </Details>
          </Card>

          {selectedPart ? (
            <Card
              emphasis
              title={`シーン ${selectedPart.index + 1}：${selectedPart.title}`}
              subtitle={selectedPart.summary || undefined}
            >
              <div className="space-y-4">
                <StaleNotice
                  project={project}
                  part={selectedPart}
                  kinds={['audio']}
                  onChange={setProject}
                />
                <NarrationOverrideNotice
                  part={selectedPart}
                  onUseScript={() =>
                    setProject((prev) =>
                      prev
                        ? {
                            ...prev,
                            parts: prev.parts.map((p) =>
                              p.id === selectedPart.id ? { ...p, narrationText: undefined } : p
                            ),
                          }
                        : prev
                    )
                  }
                />

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => void handleGenerateForSelected()}
                      disabled={Boolean(createBlockedReason) || busyHere}
                    >
                      {busyHere ? '作成中…' : selectedPart.audio ? '音声を作り直す' : '音声を作る'}
                    </Button>
                    {selectedPart.audio && (
                      <Button
                        variant="secondary"
                        onClick={() => void handleClearAudio()}
                        disabled={busyHere || Boolean(batchProgress)}
                      >
                        外す
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => navigate(`/projects/${project.id}/script`)}
                    >
                      台本を直す
                    </Button>
                  </div>
                  {busyHere ? (
                    <p className="nv-help" role="status">
                      音声を作っています…
                    </p>
                  ) : (
                    createBlockedReason && <p className="nv-help">{createBlockedReason}</p>
                  )}
                </div>

                {selectedPart.audio ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--nv-color-text)]">
                        音声（{formatSeconds(audioDurationSec ?? selectedPart.audio.durationSec)}）
                      </p>
                      <p className="nv-help">
                        {audioEngineLabel(selectedPart.audio.ttsEngine)}・声{' '}
                        {selectedPart.audio.voiceId}
                      </p>
                    </div>
                    <audio
                      ref={audioRef}
                      controls
                      src={toLocalFileUrl(selectedPart.audio.filePath)}
                      className="w-full"
                      onLoadedMetadata={(e) => {
                        const duration = e.currentTarget.duration;
                        setAudioDurationSec(Number.isFinite(duration) ? duration : null);
                        setPlaybackTimeSec(0);
                      }}
                      onDurationChange={(e) => {
                        const duration = e.currentTarget.duration;
                        setAudioDurationSec(Number.isFinite(duration) ? duration : null);
                      }}
                      onTimeUpdate={(e) => {
                        const t = e.currentTarget.currentTime;
                        if (Number.isFinite(t)) setPlaybackTimeSec(t);
                      }}
                    />
                    {syncSegments.length > 0 && (
                      <div>
                        <p className="nv-label">読み上げる文章（文を押すと、そこから再生します）</p>
                        <ol
                          ref={syncListRef}
                          className="nv-scrollbar max-h-64 overflow-auto rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-border)] bg-white"
                        >
                          {syncSegments.map((seg, idx) => {
                            const active = idx === activeSegmentIndex;
                            return (
                              <li
                                key={idx}
                                className="border-b border-[var(--nv-color-border)] last:border-b-0"
                              >
                                <button
                                  type="button"
                                  data-seg-index={idx}
                                  onClick={() => seekToSegment(idx)}
                                  aria-current={active ? 'true' : undefined}
                                  className={cx(
                                    'nv-focus-ring flex w-full gap-3 px-3 py-2 text-left text-sm transition-colors',
                                    active
                                      ? 'bg-[var(--nv-color-accent)]/10 text-[var(--nv-color-text)]'
                                      : 'text-[var(--nv-color-text)] hover:bg-[var(--nv-color-canvas)]'
                                  )}
                                >
                                  <span className="w-5 shrink-0 text-right text-xs text-[var(--nv-color-muted)] tabular-nums">
                                    {idx + 1}
                                  </span>
                                  <span>{seg}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    )}
                    <Details summary="波形を表示" onToggle={setShowWaveform}>
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
                    </Details>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="nv-label">読み上げる文章</p>
                    <div className="nv-surface-muted max-h-64 overflow-auto whitespace-pre-wrap p-3 text-sm text-[var(--nv-color-text)]">
                      {selectedPart.narrationText || selectedPart.scriptText || '（台本が空です）'}
                    </div>
                    <p className="nv-help">
                      まだ音声がありません。「音声を作る」を押すと作ります。
                    </p>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <EmptyState title="シーンを選んでください" />
          )}
        </div>
      </div>
    </div>
  );
}
