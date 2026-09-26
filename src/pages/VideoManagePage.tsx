import { useScrollMemory } from '../hooks/useScrollMemory';
import { useSceneSelection, rememberedScene } from '../stores/sceneSelection';
import { resolutionForAspect, type RenderOptions } from '../../shared/project/videoFormat';
import { renderConflictMessage } from '../../shared/project/renderIntent';
import { inputFingerprint, isVideoCurrent, partFreshness } from '../../shared/project/integrity';
import { withRenderConflictRetry } from '../utils/renderRetry';
import { projectClient, useProjectState } from '../stores/projectStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { ErrorNotice } from '../components/common/ErrorNotice';
import { describeError, type FriendlyError } from '../components/common/friendlyError';
import { useJobActive } from '../components/common/useJobActive';
import {
  alignCaptionsToScript,
  captionMismatchParts,
  captionState,
  refreshEnabledCaptions,
  setCaptionsEnabled,
} from '../components/common/captionSync';
import { loadForPreview } from '../components/common/renderPrep';
import type { AutoGenerationStatus, Project } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';
import {
  getDefaultPresentationProfile,
  normalizePresentationProfile,
  resolvePresentationSourceLine,
  type SourceDisplayMode,
} from '../../shared/project/presentationProfile';

type Settings = {
  videoResolution: RenderOptions['resolution'];
  videoFps: number;
  videoBitrate: string;
  audioBitrate: string;
  openingVideoPath: string;
  endingVideoPath: string;
};

type VideoProgress = {
  stage?: string;
  percent?: number;
  current?: number;
  total?: number;
  message?: string;
  error?: string;
};

type ResolvedVideoAsset = {
  path: string;
  mtimeMs: number | null;
};

const JOB_ACTIVE_MESSAGE = '自動生成の実行中です。完了すると、書き出しとプレビューができます。';

const SOURCE_DISPLAY_LABELS: Record<SourceDisplayMode, string> = {
  auto: '記事の出典を使う',
  hidden: '表示しない',
  custom: '自分で入力する',
};

const RESOLUTION_LABELS: Partial<Record<RenderOptions['resolution'], string>> = {
  '1280x720': 'HD',
  '1920x1080': 'フル HD',
  '3840x2160': '4K',
  '720x1280': 'HD',
  '1080x1920': 'フル HD',
  '2160x3840': '4K',
};

function progressLabel(progress: VideoProgress): string {
  switch (progress.stage) {
    case 'preparing':
      return '準備しています';
    case 'rendering_parts':
      return typeof progress.current === 'number' && typeof progress.total === 'number'
        ? `シーンを動画にしています（${progress.current}/${progress.total}）`
        : 'シーンを動画にしています';
    case 'concatenating':
      return 'シーンをつなげています';
    case 'finalizing':
      return '仕上げています';
    default:
      return '処理しています';
  }
}

function sceneNumbers(parts: Project['parts']): string {
  const numbers = parts.map((part) => part.index + 1);
  return numbers.length > 6 ? `${numbers.slice(0, 6).join('・')} ほか` : numbers.join('・');
}

export function VideoManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [project, setProject] = useProjectState(projectId);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedPartId, setSelectedPartId] = useSceneSelection(projectId);
  const scrollRef = useScrollMemory(`${projectId}:VideoManagePage`);

  const [renderOptions, setRenderOptions] = useState<RenderOptions>({
    resolution: '1920x1080',
    fps: 30,
    videoBitrate: '8M',
    audioBitrate: '192k',
    includeOpening: false,
    includeEnding: false,
  });
  const [outputPath, setOutputPath] = useState('');

  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoKind, setVideoKind] = useState<
    { kind: 'output' } | { kind: 'preview'; sceneNo: number }
  >({ kind: 'output' });
  const [videoSrcVersion, setVideoSrcVersion] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [presentationProfile, setPresentationProfile] = useState(getDefaultPresentationProfile());

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastVideoPathRef = useRef<string | null>(null);
  const lastVideoIdentityRef = useRef<string | null>(null);
  const savedPresentationProfileRef = useRef<string>(
    JSON.stringify(getDefaultPresentationProfile())
  );

  const reportError = useCallback(
    (err: unknown, title: string) => {
      console.error(title, err);
      const friendly = describeError(err, title);
      setError(friendly);
      toast.error(friendly.message, friendly.title);
    },
    [toast]
  );

  const syncVideoAsset = useCallback((path: string, identity: string) => {
    const pathChanged = lastVideoPathRef.current !== path;
    const identityChanged = lastVideoIdentityRef.current !== identity;
    if (pathChanged) setVideoPath(path);
    if (pathChanged || identityChanged) setVideoSrcVersion((prev) => prev + 1);
    lastVideoPathRef.current = path;
    lastVideoIdentityRef.current = identity;
  }, []);

  const applyResolvedVideoAsset = useCallback(
    (asset: ResolvedVideoAsset | null) => {
      if (!asset) return;
      syncVideoAsset(asset.path, `${asset.path}::${asset.mtimeMs ?? 'unknown'}`);
    },
    [syncVideoAsset]
  );

  const forceReloadVideoAsset = useCallback(
    (path: string) => {
      syncVideoAsset(path, `${path}::${Date.now()}`);
    },
    [syncVideoAsset]
  );

  const clearVideoAsset = useCallback(() => {
    setVideoPath(null);
    lastVideoPathRef.current = null;
    lastVideoIdentityRef.current = null;
  }, []);

  const resolveExistingVideoPath = useCallback(
    async (project: Project): Promise<ResolvedVideoAsset | null> => {
      const lastPath = project.autoGenerationStatus?.lastVideoPath;
      try {
        const outputDir = `${project.path}/output`;
        const entries = await window.electronAPI.file.listFiles(outputDir);
        const candidates = entries
          .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith('.mp4'))
          .sort((a, b) => b.mtimeMs - a.mtimeMs);
        const lastMatch = lastPath
          ? (candidates.find((entry) => entry.path === lastPath) ?? null)
          : null;
        if (lastMatch) return { path: lastMatch.path, mtimeMs: lastMatch.mtimeMs };
        const latest = candidates[0] ?? null;
        if (latest) return { path: latest.path, mtimeMs: latest.mtimeMs };
      } catch {
        // fallback below
      }
      if (lastPath) {
        try {
          const exists = await window.electronAPI.file.exists(lastPath);
          if (exists) return { path: lastPath, mtimeMs: null };
        } catch {
          return { path: lastPath, mtimeMs: null };
        }
      }
      return null;
    },
    []
  );

  // 自動生成ジョブの実行中は、手動の書き出しとプレビューを受け付けない(ジョブの動画工程と競合させない)
  const jobActive = useJobActive(projectId, project);

  const readiness = useMemo(() => {
    if (!project) return null;
    const noAudio: Project['parts'] = [];
    const noImage: Project['parts'] = [];
    const stale: Project['parts'] = [];
    for (const part of project.parts) {
      const state = partFreshness(project, part);
      if (state.audio === 'missing') noAudio.push(part);
      if (state.image === 'missing') noImage.push(part);
      if (
        state.audio !== 'missing' &&
        state.image !== 'missing' &&
        (state.script === 'stale' || state.image === 'stale' || state.audio === 'stale')
      )
        stale.push(part);
    }
    return { noAudio, noImage, stale, hasVideoOutput: isVideoCurrent(project) };
  }, [project]);

  const selectedPart = useMemo(
    () => project?.parts.find((p) => p.id === selectedPartId) ?? null,
    [project, selectedPartId]
  );

  const videoSrc = useMemo(() => {
    if (!videoPath) return null;
    return `${toLocalFileUrl(videoPath)}?v=${videoSrcVersion}`;
  }, [videoPath, videoSrcVersion]);

  useEffect(() => {
    lastVideoPathRef.current = videoPath;
  }, [videoPath]);

  // src が同一のまま更新されるケースに備えて明示的に load する
  useEffect(() => {
    if (!videoSrc) return;
    setMediaError(null);
    const el = videoRef.current;
    el?.pause();
    el?.load();
    if (el) el.currentTime = 0;
  }, [videoSrc]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.events.subscribe(
      'progress:update',
      (payload: unknown) => {
        const p = payload as { source?: string } & VideoProgress;
        if (p?.source !== 'video') return;
        setProgress(p);
        setShowProgress(true);
        if (typeof p.percent === 'number' && p.percent >= 100) {
          setTimeout(() => setShowProgress(false), 800);
        }
      }
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!projectId) return;
      try {
        setIsLoading(true);
        const [loadedProject, loadedSettings] = await Promise.all([
          projectClient.load(projectId),
          window.electronAPI.settings.get(),
        ]);

        const normalizedPresentationProfile = normalizePresentationProfile(
          loadedProject.presentationProfile
        );
        const normalizedProject: Project = {
          ...loadedProject,
          presentationProfile: normalizedPresentationProfile,
        };

        setProject(normalizedProject);
        setPresentationProfile(normalizedPresentationProfile);
        savedPresentationProfileRef.current = JSON.stringify(normalizedPresentationProfile);
        const normalizedSettings: Settings = {
          videoResolution: loadedSettings.videoResolution ?? '1920x1080',
          videoFps: loadedSettings.videoFps ?? 30,
          videoBitrate: loadedSettings.videoBitrate ?? '8M',
          audioBitrate: loadedSettings.audioBitrate ?? '192k',
          openingVideoPath:
            typeof (loadedSettings as Partial<Settings>).openingVideoPath === 'string'
              ? (loadedSettings as Partial<Settings>).openingVideoPath!
              : '',
          endingVideoPath:
            typeof (loadedSettings as Partial<Settings>).endingVideoPath === 'string'
              ? (loadedSettings as Partial<Settings>).endingVideoPath!
              : '',
        };
        setSettings(normalizedSettings);

        setSelectedPartId(
          normalizedProject.parts[0] ? rememberedScene(projectId, normalizedProject.parts) : null
        );

        const defaults: RenderOptions = {
          videoPartLeadInSec: loadedSettings.videoPartLeadInSec ?? 0.3,
          openingVideoPath: loadedSettings.openingVideoPath,
          endingVideoPath: loadedSettings.endingVideoPath,
          resolution: resolutionForAspect(
            normalizedSettings.videoResolution,
            normalizedProject.presentationProfile.aspectRatio
          ),
          fps: normalizedSettings.videoFps,
          videoBitrate: normalizedSettings.videoBitrate,
          audioBitrate: normalizedSettings.audioBitrate,
          includeOpening: Boolean(normalizedSettings.openingVideoPath),
          includeEnding: Boolean(normalizedSettings.endingVideoPath),
        };
        setRenderOptions(
          normalizedProject.outputSettings
            ? {
                ...defaults,
                ...normalizedProject.outputSettings,
                resolution: resolutionForAspect(
                  normalizedProject.outputSettings.resolution,
                  normalizedProject.presentationProfile.aspectRatio
                ),
              }
            : defaults
        );

        const safeName =
          normalizedProject.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'output';
        setOutputPath(`${normalizedProject.path}/output/${safeName}.mp4`);

        const existingVideoPath = await resolveExistingVideoPath(normalizedProject);
        if (existingVideoPath) {
          applyResolvedVideoAsset(existingVideoPath);
          if (existingVideoPath.path !== normalizedProject.autoGenerationStatus?.lastVideoPath) {
            const now = new Date().toISOString();
            const current = normalizedProject.autoGenerationStatus;
            const nextStatus: AutoGenerationStatus = {
              running: current?.running ?? false,
              step: current?.running ? current?.step : (current?.step ?? '完了'),
              startedAt: current?.startedAt,
              updatedAt: now,
              finishedAt: current?.running ? current?.finishedAt : now,
              cancelRequested: current?.cancelRequested,
              error: current?.error,
              steps: { ...(current?.steps ?? {}), video: true },
              lastVideoPath: existingVideoPath.path,
            };
            const updatedProject: Project = {
              ...normalizedProject,
              autoGenerationStatus: nextStatus,
              updatedAt: now,
            };
            await projectClient.save(updatedProject);
            setProject(updatedProject);
          }
        } else {
          clearVideoAsset();
        }
      } catch (err) {
        console.error('Failed to load project/settings:', err);
        setLoadError(describeError(err, '読み込めませんでした').message);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [
    applyResolvedVideoAsset,
    clearVideoAsset,
    projectId,
    resolveExistingVideoPath,
    setProject,
    setSelectedPartId,
  ]);

  useEffect(() => {
    if (!project) return;
    const serialized = JSON.stringify(presentationProfile);
    if (serialized === savedPresentationProfileRef.current) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        const updatedProject: Project = {
          ...project,
          presentationProfile,
          updatedAt: new Date().toISOString(),
        };
        await projectClient.save(updatedProject);
        savedPresentationProfileRef.current = serialized;
        setProject(updatedProject);
      } catch (err) {
        reportError(err, '締めの画面の設定を保存できませんでした');
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [presentationProfile, project, reportError, setProject]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (isRendering || isPreviewing) return;
      try {
        const latest = await projectClient.load(projectId);
        if (cancelled) return;
        setProject({
          ...latest,
          presentationProfile: normalizePresentationProfile(latest.presentationProfile),
        });
        const candidate = await resolveExistingVideoPath(latest);
        applyResolvedVideoAsset(candidate);
      } catch {
        // ignore
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    applyResolvedVideoAsset,
    projectId,
    resolveExistingVideoPath,
    isRendering,
    isPreviewing,
    setProject,
  ]);

  const handleSelectOutputDir = useCallback(async () => {
    if (!project) return;
    const dir = await window.electronAPI.file.selectDirectory();
    if (!dir) return;
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'output';
    setOutputPath(`${dir}/${safeName}.mp4`);
  }, [project]);

  const handleRevealOutput = useCallback(async () => {
    const target = (videoKind.kind === 'output' && videoPath) || outputPath.trim();
    if (!target) return;
    await window.electronAPI.file.revealInFinder(target);
  }, [outputPath, videoKind.kind, videoPath]);

  const handleToggleCaptions = useCallback(
    (enabled: boolean) => {
      setProject((prev) => (prev ? setCaptionsEnabled(prev, enabled) : prev));
    },
    [setProject]
  );

  const handleAlignCaptions = useCallback(
    async (partIds: string[]) => {
      const accepted = await confirm({
        title: '字幕を台本に合わせますか?',
        description:
          '選んだシーンの字幕を、今の台本と音声から作り直します。以前に手で直した字幕の文は、台本の文に置き換わります。',
        confirmLabel: '合わせる',
        confirmVariant: 'primary',
      });
      if (!accepted) return;
      setProject((prev) => (prev ? alignCaptionsToScript(prev, partIds) : prev));
    },
    [confirm, setProject]
  );

  const handleGeneratePreview = useCallback(async () => {
    if (!selectedPart || !projectId) return;
    if (jobActive) {
      toast.info(JOB_ACTIVE_MESSAGE, 'プレビューできません');
      return;
    }
    const partId = selectedPart.id;
    const sceneNo = selectedPart.index + 1;
    try {
      setIsPreviewing(true);
      setError(null);
      const res = await withRenderConflictRetry(projectId, async () => {
        // 画面が意図した内容を保存してから渡す(Main 側で最新の保存内容と照合する)
        const intended = await loadForPreview(projectId);
        return window.electronAPI.video.preview(partId, intended);
      });
      setVideoKind({ kind: 'preview', sceneNo });
      forceReloadVideoAsset(res.previewPath);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
      }, 0);
    } catch (err) {
      reportError(err, 'プレビューを作れませんでした');
    } finally {
      setIsPreviewing(false);
    }
  }, [forceReloadVideoAsset, jobActive, projectId, reportError, selectedPart, toast]);

  const handleRender = useCallback(async () => {
    if (!project) return;
    if (jobActive) {
      toast.info(JOB_ACTIVE_MESSAGE, '書き出しできません');
      return;
    }
    if (!outputPath.trim()) {
      toast.warning('保存先を選んでから書き出してください。', '保存先が決まっていません');
      return;
    }

    try {
      setIsRendering(true);
      setError(null);
      setShowProgress(true);
      setProgress({ stage: 'preparing', percent: 0 });

      const effectiveOptions = {
        ...renderOptions,
        resolution: resolutionForAspect(renderOptions.resolution, presentationProfile.aspectRatio),
      };
      const res = await withRenderConflictRetry(project.id, async (isRetry) => {
        // 再試行のときは読み直した最新の保持データから組み立てる
        const loaded = await projectClient.load(project.id);
        // 締めカードなどの表示設定は画面の値で上書きするので、読み直した保存内容と食い違う
        // (画面に未保存の編集がある、または別の保存で変わった)ときは自動で再試行しない
        if (
          isRetry &&
          inputFingerprint(normalizePresentationProfile(loaded.presentationProfile)) !==
            inputFingerprint(presentationProfile)
        )
          throw new Error(renderConflictMessage('render'));
        // 字幕が ON のシーンは、台本や音声に合わせて字幕を最新にしてから書き出す
        const source = refreshEnabledCaptions(loaded) ?? loaded;
        const renderProject: Project = {
          ...source,
          presentationProfile,
          outputSettings: effectiveOptions,
        };
        await projectClient.save(renderProject);
        return window.electronAPI.video.render(renderProject, effectiveOptions, outputPath.trim());
      });
      setVideoKind({ kind: 'output' });
      forceReloadVideoAsset(res.outputPath);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
      }, 0);
      toast.success('動画を書き出しました', '完成しました');
    } catch (err) {
      reportError(err, '動画を書き出せませんでした');
    } finally {
      setIsRendering(false);
    }
  }, [
    forceReloadVideoAsset,
    jobActive,
    outputPath,
    presentationProfile,
    project,
    renderOptions,
    reportError,
    toast,
  ]);

  const handleCancel = useCallback(async () => {
    try {
      await window.electronAPI.video.cancelRender();
      setShowProgress(false);
      setIsRendering(false);
      setIsPreviewing(false);
      setError(null);
      toast.info('動画の処理を止めました。', '止めました');
    } catch (err) {
      console.warn('Failed to cancel render:', err);
    }
  }, [toast]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[var(--nv-color-muted)]">読み込み中...</p>
      </div>
    );
  }

  if (!project || !settings || !readiness) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="プロジェクトを読み込めません"
          description={loadError || 'プロジェクトが見つかりません'}
          action={<Button onClick={() => navigate('/projects')}>プロジェクト一覧に戻る</Button>}
        />
      </div>
    );
  }

  const returnTo = `/projects/${project.id}/video`;
  const busy = isRendering || isPreviewing;
  const captions = captionState(project);
  const captionMismatches = captionMismatchParts(project);
  const effectiveResolution = resolutionForAspect(
    renderOptions.resolution,
    presentationProfile.aspectRatio
  );
  const blockingIssues = readiness.noAudio.length > 0 || readiness.noImage.length > 0;
  const renderBlockedReason = jobActive
    ? JOB_ACTIVE_MESSAGE
    : project.parts.length === 0
      ? 'シーンがありません。記事画面の「おまかせで作る」から始めてください。'
      : blockingIssues
        ? '画像か音声がないシーンがあります。上の案内から作ってください。'
        : !outputPath.trim()
          ? '保存先を選んでください。'
          : null;
  const previewBlockedReason = jobActive
    ? JOB_ACTIVE_MESSAGE
    : !selectedPart
      ? '左の一覧からシーンを選んでください。'
      : partFreshness(project, selectedPart).audio === 'missing'
        ? 'このシーンには音声がありません。'
        : partFreshness(project, selectedPart).image === 'missing'
          ? 'このシーンには画像がありません。'
          : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="動画" subtitle={project.name} />

      {projectId && <WorkflowNav projectId={projectId} current="video" project={project} />}

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <SceneList
          className="w-56 shrink-0"
          scenes={project.parts}
          selectedId={selectedPartId}
          onSelect={setSelectedPartId}
          subtitle={`全 ${project.parts.length} シーン`}
          renderStatus={(part) => {
            const state = partFreshness(project, part);
            const ready = state.audio !== 'missing' && state.image !== 'missing';
            return ready ? (
              <Badge tone="success">準備完了</Badge>
            ) : (
              <>
                {state.image === 'missing' && <Badge tone="warning">画像なし</Badge>}
                {state.audio === 'missing' && <Badge tone="warning">音声なし</Badge>}
              </>
            );
          }}
        />

        <div
          ref={scrollRef}
          className="@container nv-scrollbar min-h-0 min-w-0 flex-1 space-y-4 overflow-auto pr-1"
        >
          <ErrorNotice error={error} onDismiss={() => setError(null)} returnTo={returnTo} />

          <Card
            emphasis
            title="書き出し"
            subtitle={
              readiness.hasVideoOutput
                ? '最新の内容で書き出し済みです'
                : '内容を確認して、動画ファイルに書き出します'
            }
          >
            <div className="space-y-4">
              {jobActive && (
                <p
                  role="status"
                  className="rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-accent)]/30 bg-[var(--nv-color-accent)]/5 px-3 py-2 text-sm font-semibold text-[var(--nv-color-accent)]"
                >
                  {JOB_ACTIVE_MESSAGE}
                </p>
              )}

              <section aria-label="書き出し前の確認" className="space-y-2">
                {project.parts.length === 0 ? (
                  <p className="nv-help">シーンがありません。</p>
                ) : !blockingIssues ? (
                  <p className="rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-success)]/30 bg-[var(--nv-color-success)]/5 px-3 py-2 text-sm text-[var(--nv-color-text)]">
                    すべてのシーンの画像と音声がそろっています。
                  </p>
                ) : null}
                {readiness.noImage.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-warning)]/30 bg-[var(--nv-color-warning)]/5 px-3 py-2">
                    <p className="text-sm text-[var(--nv-color-text)]">
                      画像がないシーン: {sceneNumbers(readiness.noImage)}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(`/projects/${project.id}/image`)}
                    >
                      画像を作る
                    </Button>
                  </div>
                )}
                {readiness.noAudio.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-warning)]/30 bg-[var(--nv-color-warning)]/5 px-3 py-2">
                    <p className="text-sm text-[var(--nv-color-text)]">
                      音声がないシーン: {sceneNumbers(readiness.noAudio)}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(`/projects/${project.id}/audio`)}
                    >
                      音声を作る
                    </Button>
                  </div>
                )}
                {readiness.stale.length > 0 && (
                  <p className="nv-help">
                    台本の変更後に作り直していない素材があります（シーン{' '}
                    {sceneNumbers(readiness.stale)}）。このまま書き出すこともできます。
                  </p>
                )}
              </section>

              <div className="space-y-3">
                <Checkbox
                  checked={captions === 'on'}
                  indeterminate={captions === 'mixed'}
                  onChange={handleToggleCaptions}
                  disabled={busy || project.parts.length === 0}
                  label="字幕を入れる"
                  description={
                    captions === 'mixed'
                      ? '一部のシーンだけ字幕が入っています。チェックすると、すべてのシーンに入れます。'
                      : '台本の文章を、読み上げに合わせて画面の下に表示します。'
                  }
                />
                {captionMismatches.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-warning)]/30 bg-[var(--nv-color-warning)]/5 px-3 py-2">
                    <p className="min-w-0 flex-1 text-sm text-[var(--nv-color-text)]">
                      字幕の文が台本と違うシーンがあります（シーン {sceneNumbers(captionMismatches)}
                      ）。
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void handleAlignCaptions(captionMismatches.map((p) => p.id))}
                    >
                      字幕を台本に合わせる
                    </Button>
                  </div>
                )}
                {(settings.openingVideoPath || settings.endingVideoPath) && (
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {settings.openingVideoPath && (
                      <Checkbox
                        checked={renderOptions.includeOpening}
                        onChange={(checked) => {
                          const next = { ...renderOptions, includeOpening: checked };
                          setRenderOptions(next);
                          setProject({ ...project, outputSettings: next });
                        }}
                        disabled={busy}
                        label="最初にオープニング動画を入れる"
                      />
                    )}
                    {settings.endingVideoPath && (
                      <Checkbox
                        checked={renderOptions.includeEnding}
                        onChange={(checked) => {
                          const next = { ...renderOptions, includeEnding: checked };
                          setRenderOptions(next);
                          setProject({ ...project, outputSettings: next });
                        }}
                        disabled={busy}
                        label="最後にエンディング動画を入れる"
                      />
                    )}
                  </div>
                )}
              </div>

              <div>
                <p className="nv-label">保存先</p>
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className="min-w-0 flex-1 truncate rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-border)] bg-[var(--nv-color-canvas)] px-3 py-2 font-mono text-xs text-[var(--nv-color-muted)]"
                    title={outputPath}
                  >
                    {outputPath.trim() || '未設定'}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSelectOutputDir}
                    disabled={busy}
                  >
                    場所を変える
                  </Button>
                </div>
                <p className="nv-help mt-1">
                  画質: {effectiveResolution}
                  {RESOLUTION_LABELS[effectiveResolution]
                    ? `（${RESOLUTION_LABELS[effectiveResolution]}）`
                    : ''}
                  。 画質は設定画面で変えられます。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--nv-color-border)] pt-4">
                <Button
                  size="lg"
                  variant="success"
                  onClick={() => void handleRender()}
                  disabled={busy || Boolean(renderBlockedReason)}
                  title={renderBlockedReason ?? undefined}
                >
                  {isRendering ? '書き出し中…' : '動画を書き出す'}
                </Button>
                {busy && (
                  <Button variant="secondary" onClick={handleCancel}>
                    止める
                  </Button>
                )}
                {videoPath && videoKind.kind === 'output' && !busy && (
                  <Button variant="ghost" onClick={() => void handleRevealOutput()}>
                    Finder で表示
                  </Button>
                )}
                {renderBlockedReason && !busy && (
                  <p className="nv-help basis-full">{renderBlockedReason}</p>
                )}
              </div>
            </div>
          </Card>

          <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Card
              title="プレビュー"
              subtitle={
                !videoPath
                  ? 'まだ動画はありません'
                  : videoKind.kind === 'preview'
                    ? `シーン ${videoKind.sceneNo} のプレビュー`
                    : '書き出した動画'
              }
            >
              <div className="space-y-3">
                <div
                  className="w-full overflow-hidden rounded-[var(--nv-radius-md)] bg-black"
                  style={{ aspectRatio: presentationProfile.aspectRatio.replace(':', ' / ') }}
                >
                  {videoSrc ? (
                    <video
                      key={videoSrc}
                      ref={videoRef}
                      src={videoSrc}
                      controls
                      className="h-full w-full"
                      onError={() => {
                        const code = videoRef.current?.error?.code ?? 0;
                        setMediaError(
                          code === 3 || code === 4
                            ? 'この動画ファイルは再生できませんでした。もう一度書き出すか、プレビューを作り直してください。'
                            : '動画ファイルを読み込めませんでした。ファイルが移動・削除されていないか確認してください。'
                        );
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-white/70">
                      シーンのプレビューを作るか、動画を書き出すと、ここで再生できます
                    </div>
                  )}
                </div>
                {mediaError && (
                  <p role="alert" className="text-sm text-[var(--nv-color-danger)]">
                    {mediaError}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void handleGeneratePreview()}
                    disabled={busy || Boolean(previewBlockedReason)}
                    title={previewBlockedReason ?? undefined}
                  >
                    {isPreviewing
                      ? 'プレビューを作っています…'
                      : selectedPart
                        ? `シーン ${selectedPart.index + 1} をプレビュー`
                        : 'シーンをプレビュー'}
                  </Button>
                  {previewBlockedReason && !busy && (
                    <p className="nv-help">{previewBlockedReason}</p>
                  )}
                </div>
              </div>
            </Card>

            <Card title="締めの画面" subtitle="動画の最後に出す画面です">
              <div className="space-y-4">
                <Checkbox
                  checked={presentationProfile.closingCardEnabled}
                  onChange={(checked) =>
                    setPresentationProfile((prev) => ({ ...prev, closingCardEnabled: checked }))
                  }
                  disabled={busy}
                  label="締めの画面を入れる"
                />
                {presentationProfile.closingCardEnabled && (
                  <>
                    <div>
                      <label htmlFor="closing-headline" className="nv-label">
                        見出し
                      </label>
                      <input
                        id="closing-headline"
                        type="text"
                        value={presentationProfile.closingCardHeadline}
                        onChange={(e) =>
                          setPresentationProfile((prev) => ({
                            ...prev,
                            closingCardHeadline: e.target.value,
                          }))
                        }
                        className="nv-input"
                        disabled={busy}
                        placeholder="ご視聴ありがとうございました"
                      />
                    </div>
                    <div>
                      <label htmlFor="closing-message" className="nv-label">
                        ひとこと（任意）
                      </label>
                      <input
                        id="closing-message"
                        type="text"
                        value={presentationProfile.closingCardCtaText}
                        onChange={(e) =>
                          setPresentationProfile((prev) => ({
                            ...prev,
                            closingCardCtaText: e.target.value,
                          }))
                        }
                        className="nv-input"
                        disabled={busy}
                        placeholder="続きは概要欄から確認してください"
                      />
                    </div>
                    <div>
                      <label htmlFor="closing-source" className="nv-label">
                        出典の表示
                      </label>
                      <select
                        id="closing-source"
                        value={presentationProfile.sourceDisplayMode}
                        onChange={(e) =>
                          setPresentationProfile((prev) => ({
                            ...prev,
                            sourceDisplayMode: e.target.value as SourceDisplayMode,
                          }))
                        }
                        className="nv-input"
                        disabled={busy}
                      >
                        {(Object.keys(SOURCE_DISPLAY_LABELS) as SourceDisplayMode[]).map((mode) => (
                          <option key={mode} value={mode}>
                            {SOURCE_DISPLAY_LABELS[mode]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {presentationProfile.sourceDisplayMode === 'custom' && (
                      <div>
                        <label htmlFor="closing-source-text" className="nv-label">
                          出典として表示する文
                        </label>
                        <input
                          id="closing-source-text"
                          type="text"
                          value={presentationProfile.sourceDisplayText}
                          onChange={(e) =>
                            setPresentationProfile((prev) => ({
                              ...prev,
                              sourceDisplayText: e.target.value,
                            }))
                          }
                          className="nv-input"
                          disabled={busy}
                          placeholder="出典: 社内広報資料"
                        />
                      </div>
                    )}
                    <Details summary="締めの画面に出る文を確認">
                      <dl className="space-y-2 text-sm">
                        <div>
                          <dt className="nv-label">見出し</dt>
                          <dd>{presentationProfile.closingCardHeadline.trim() || '（なし）'}</dd>
                        </div>
                        <div>
                          <dt className="nv-label">ひとこと</dt>
                          <dd>{presentationProfile.closingCardCtaText.trim() || '（なし）'}</dd>
                        </div>
                        <div>
                          <dt className="nv-label">出典</dt>
                          <dd>
                            {resolvePresentationSourceLine(
                              presentationProfile,
                              project.article.source
                            ) ?? '（なし）'}
                          </dd>
                        </div>
                      </dl>
                    </Details>
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {showProgress && progress && busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nv-color-text)]/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-progress-title"
            className="nv-surface w-full max-w-md p-5"
          >
            <h3
              id="video-progress-title"
              className="mb-2 text-base font-semibold text-[var(--nv-color-text)]"
            >
              {isRendering ? '動画を書き出しています' : 'プレビューを作っています'}
            </h3>
            <p className="mb-3 text-sm text-[var(--nv-color-muted)]">{progressLabel(progress)}</p>
            <ProgressBar
              value={Math.min(100, Math.max(0, progress.percent ?? 0))}
              max={100}
              label={
                typeof progress.percent === 'number'
                  ? `${Math.round(progress.percent)}%`
                  : undefined
              }
            />
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={handleCancel}>
                止める
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
