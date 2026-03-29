import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorDetailPanel,
  ProgressBar,
  StatusChip,
  useToast,
} from '../components/ui';
import type { AutoGenerationStatus, Project } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';
import { summarizeProjectProgress } from '../utils/projectHealth';
import {
  SOURCE_DISPLAY_MODE_LABELS,
  getDefaultPresentationProfile,
  normalizePresentationProfile,
  resolvePresentationSourceLine,
} from '../../shared/project/presentationProfile';

type RenderOptions = {
  resolution: '1920x1080' | '1280x720' | '3840x2160';
  fps: number;
  videoBitrate: string;
  audioBitrate: string;
  includeOpening: boolean;
  includeEnding: boolean;
};

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

export function VideoManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

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
  const [videoSrcVersion, setVideoSrcVersion] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaDebug, setMediaDebug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    (message: string, title?: string) => {
      setError(message);
      toast.error(message, title);
    },
    [toast]
  );

  const syncVideoAsset = useCallback((path: string, identity: string) => {
    const pathChanged = lastVideoPathRef.current !== path;
    const identityChanged = lastVideoIdentityRef.current !== identity;

    if (pathChanged) {
      setVideoPath(path);
    }

    if (pathChanged || identityChanged) {
      setVideoSrcVersion((prev) => prev + 1);
    }

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

  const resolveExistingVideoPath = useCallback(async (project: Project): Promise<ResolvedVideoAsset | null> => {
    const lastPath = project.autoGenerationStatus?.lastVideoPath;

    try {
      const outputDir = `${project.path}/output`;
      const entries = await window.electronAPI.file.listFiles(outputDir);
      const candidates = entries
        .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith('.mp4'))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      const lastMatch = lastPath ? candidates.find((entry) => entry.path === lastPath) ?? null : null;
      if (lastMatch) {
        return { path: lastMatch.path, mtimeMs: lastMatch.mtimeMs };
      }
      const latest = candidates[0] ?? null;
      if (latest) {
        return { path: latest.path, mtimeMs: latest.mtimeMs };
      }
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
  }, []);

  const missingAudioCount = useMemo(() => {
    if (!project) return 0;
    return project.parts.filter((p) => !p.audio).length;
  }, [project]);

  const missingImagesCount = useMemo(() => {
    if (!project) return 0;
    return project.parts.filter((p) => (p.panelImages?.length ?? 0) === 0).length;
  }, [project]);
  const summary = useMemo(() => (project ? summarizeProjectProgress(project) : null), [project]);
  const closingSourcePreview = useMemo(
    () => resolvePresentationSourceLine(presentationProfile, project?.article.source),
    [presentationProfile, project?.article.source]
  );

  const selectedPart = useMemo(() => {
    return project?.parts.find((p) => p.id === selectedPartId) ?? null;
  }, [project, selectedPartId]);

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
    setMediaDebug(null);
    const el = videoRef.current;
    el?.pause();
    el?.load();
    if (el) {
      el.currentTime = 0;
    }
  }, [videoSrc]);

  // 失敗時の切り分け用（レスポンスヘッダ/Range対応確認）
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!videoSrc || !mediaError) {
        setMediaDebug(null);
        return;
      }
      try {
        const headRes = await fetch(videoSrc, { method: 'HEAD' });
        const rangeRes = await fetch(videoSrc, { headers: { Range: 'bytes=0-1' } });
        if (cancelled) return;
        const fmt = (res: Response) => {
          const ct = res.headers.get('content-type');
          const cl = res.headers.get('content-length');
          const cr = res.headers.get('content-range');
          return `${res.status} ct=${ct ?? '-'} len=${cl ?? '-'} range=${cr ?? '-'}`;
        };
        setMediaDebug(`HEAD: ${fmt(headRes)} / RANGE: ${fmt(rangeRes)}`);
      } catch (err) {
        if (cancelled) return;
        setMediaDebug(err instanceof Error ? err.message : 'fetch failed');
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [mediaError, videoSrc]);

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
        setError(null);

        const [loadedProject, loadedSettings] = await Promise.all([
          window.electronAPI.project.load(projectId),
          window.electronAPI.settings.get(),
        ]);

        const normalizedPresentationProfile = normalizePresentationProfile(loadedProject.presentationProfile);
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

        setSelectedPartId(normalizedProject.parts[0]?.id ?? null);

        const defaults: RenderOptions = {
          resolution: normalizedSettings.videoResolution,
          fps: normalizedSettings.videoFps,
          videoBitrate: normalizedSettings.videoBitrate,
          audioBitrate: normalizedSettings.audioBitrate,
          includeOpening: Boolean(normalizedSettings.openingVideoPath),
          includeEnding: Boolean(normalizedSettings.endingVideoPath),
        };
        setRenderOptions(defaults);

        const safeName = normalizedProject.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'output';
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
            await window.electronAPI.project.save(updatedProject);
            setProject(updatedProject);
          }
        } else {
          clearVideoAsset();
        }
      } catch (err) {
        console.error('Failed to load project/settings:', err);
        reportError(err instanceof Error ? err.message : '読み込みに失敗しました', '読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [applyResolvedVideoAsset, clearVideoAsset, projectId, reportError, resolveExistingVideoPath]);

  useEffect(() => {
    if (!project) return;

    const serialized = JSON.stringify(presentationProfile);
    if (serialized === savedPresentationProfileRef.current) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        const updatedAt = new Date().toISOString();
        const updatedProject: Project = {
          ...project,
          presentationProfile,
          updatedAt,
        };
        await window.electronAPI.project.save(updatedProject);
        savedPresentationProfileRef.current = serialized;
        setProject(updatedProject);
      } catch (err) {
        console.error('Failed to save video presentation profile:', err);
        reportError(
          err instanceof Error ? err.message : '動画設定の保存に失敗しました',
          '動画設定の保存に失敗しました'
        );
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [presentationProfile, project, reportError]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (isRendering || isPreviewing) return;
      try {
        const latest = await window.electronAPI.project.load(projectId);
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
  }, [applyResolvedVideoAsset, projectId, resolveExistingVideoPath, isRendering, isPreviewing]);

  const handleSelectOutputDir = useCallback(async () => {
    if (!project) return;
    const dir = await window.electronAPI.file.selectDirectory();
    if (!dir) return;
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'output';
    setOutputPath(`${dir}/${safeName}.mp4`);
  }, [project]);

  const handleRevealOutput = useCallback(async () => {
    if (!outputPath.trim()) return;
    await window.electronAPI.file.revealInFinder(outputPath.trim());
  }, [outputPath]);

  const handleGeneratePreview = useCallback(async () => {
    if (!selectedPartId) return;
    try {
      setIsPreviewing(true);
      setError(null);
      const res = await window.electronAPI.video.preview(selectedPartId);
      forceReloadVideoAsset(res.previewPath);
      // 先頭から再生できるように
      setTimeout(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
      }, 0);
    } catch (err) {
      console.error('Failed to generate preview:', err);
      reportError(err instanceof Error ? err.message : 'プレビュー生成に失敗しました');
    } finally {
      setIsPreviewing(false);
    }
  }, [forceReloadVideoAsset, reportError, selectedPartId]);

  const handleRender = useCallback(async () => {
    if (!project) return;
    if (!outputPath.trim()) {
      setError(null);
      toast.warning('保存先を選択してから書き出してください。', '出力先が未指定です');
      return;
    }

    try {
      setIsRendering(true);
      setError(null);
      setShowProgress(true);
      setProgress({ stage: 'preparing', percent: 0, message: '準備中...' });

      const renderProject: Project = {
        ...project,
        presentationProfile,
      };
      const res = await window.electronAPI.video.render(renderProject, renderOptions, outputPath.trim());
      forceReloadVideoAsset(res.outputPath);
      try {
        const now = new Date().toISOString();
        const current = renderProject.autoGenerationStatus;
        const nextStatus: AutoGenerationStatus = {
          running: current?.running ?? false,
          step: current?.running ? current?.step : '完了',
          startedAt: current?.startedAt,
          updatedAt: now,
          finishedAt: current?.running ? current?.finishedAt : now,
          cancelRequested: current?.cancelRequested,
          error: current?.error,
          steps: { ...(current?.steps ?? {}), video: true },
          lastVideoPath: res.outputPath,
        };
        const updatedProject: Project = {
          ...renderProject,
          autoGenerationStatus: nextStatus,
          updatedAt: now,
        };
        await window.electronAPI.project.save(updatedProject);
        setProject(updatedProject);
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
      }, 0);
    } catch (err) {
      console.error('Failed to render video:', err);
      reportError(err instanceof Error ? err.message : '動画書き出しに失敗しました');
    } finally {
      setIsRendering(false);
    }
  }, [forceReloadVideoAsset, outputPath, presentationProfile, project, renderOptions, reportError, toast]);

  const handleCancel = useCallback(async () => {
    try {
      await window.electronAPI.video.cancelRender();
      setShowProgress(false);
      setIsRendering(false);
      setIsPreviewing(false);
      setError(null);
      toast.info('動画の処理をキャンセルしました。', 'キャンセル');
    } catch (err) {
      console.warn('Failed to cancel render:', err);
    }
  }, [toast]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">読み込み中...</p>
      </div>
    );
  }

  if (!project || !settings) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="プロジェクトを読み込めません"
          description={error || 'プロジェクトが見つかりません'}
          action={<Button onClick={() => navigate('/projects')}>プロジェクト一覧に戻る</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="動画" subtitle={project.name} />

      {projectId && <WorkflowNav projectId={projectId} current="video" project={project} />}

      {error && (
        <div className="px-4 pt-4">
          <ErrorDetailPanel message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="px-4 pt-3">
        <Card
          title="書き出し操作"
          subtitle="プレビュー確認後に最終書き出し"
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={handleGeneratePreview}
                disabled={isPreviewing || isRendering || !selectedPartId}
              >
                {isPreviewing ? 'プレビュー生成中...' : '選択パートをプレビュー'}
              </Button>
              <Button
                variant="success"
                onClick={handleRender}
                disabled={isRendering || isPreviewing || project.parts.length === 0}
              >
                {isRendering ? '書き出し中...' : '動画を書き出し'}
              </Button>
              {(isRendering || isPreviewing) && (
                <Button variant="secondary" onClick={handleCancel}>
                  キャンセル
                </Button>
              )}
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={missingAudioCount === 0 ? 'success' : 'warning'}>
              音声未生成 {missingAudioCount}
            </Badge>
            <Badge tone={missingImagesCount === 0 ? 'success' : 'warning'}>
              画像未割当 {missingImagesCount}
            </Badge>
            <StatusChip
              tone={summary?.hasVideoOutput ? 'success' : 'info'}
              label={summary?.hasVideoOutput ? '書き出し済みあり' : '未書き出し'}
            />
          </div>
        </Card>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_380px] gap-4 overflow-hidden p-4">
        <Card
          title="パート一覧"
          subtitle={`全 ${project.parts.length} パート`}
          className="overflow-hidden"
        >
          <ul className="nv-scrollbar max-h-[calc(100vh-320px)] space-y-2 overflow-auto pr-1">
            {project.parts.map((part, idx) => {
              const hasAudio = Boolean(part.audio);
              const hasImages = (part.panelImages?.length ?? 0) > 0;
              return (
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
                      <span className="text-xs text-slate-400">{idx + 1}</span>
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {part.title}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[11px]">
                      <Badge tone={hasAudio ? 'success' : 'warning'}>
                        {hasAudio ? '音声OK' : '音声NG'}
                      </Badge>
                      <Badge tone={hasImages ? 'success' : 'warning'}>
                        {hasImages ? `画像${part.panelImages.length}` : '画像NG'}
                      </Badge>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          title="プレビュー"
          subtitle={
            selectedPart ? `${selectedPart.index + 1}. ${selectedPart.title}` : 'パート未選択'
          }
          className="overflow-auto"
        >
          <div className="space-y-3">
            <div className="aspect-video w-full overflow-hidden rounded-[12px] bg-black">
              {videoSrc ? (
                <video
                  key={videoSrc}
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  className="h-full w-full"
                  onError={() => {
                    const code = videoRef.current?.error?.code ?? 0;
                    const label =
                      code === 1
                        ? '読み込みが中断されました'
                        : code === 2
                          ? 'ネットワークエラー（ファイル読み込み失敗）'
                          : code === 3
                            ? 'デコードエラー（コーデック/ファイル破損）'
                            : code === 4
                              ? '非対応の形式です'
                              : '再生エラー';
                    setMediaError(`${label}（code=${code}）`);
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-slate-300">
                  プレビュー生成後に表示
                </div>
              )}
            </div>
            {mediaError && (
              <ErrorDetailPanel
                title="再生エラー"
                message={mediaError}
                onDismiss={() => setMediaError(null)}
                className="px-3 py-2"
              />
            )}
            {mediaDebug && (
              <div className="rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 px-3 py-2 text-xs text-slate-700 break-all">
                {mediaDebug}
              </div>
            )}
            {videoPath && <div className="text-xs text-slate-500 break-all">{videoPath}</div>}
          </div>
        </Card>

        <div className="space-y-4 overflow-auto">
          <Card
            title="締めカード設定"
            subtitle="案件ごとの outro 文言をここで調整"
          >
            <div className="space-y-4">
              <div className="rounded-[10px] border border-[var(--nv-color-border)] bg-slate-50 p-3 text-xs text-slate-600">
                <p>
                  ここで調整するのは project ごとの締めカードです。設定画面の `オープニング / エンディング動画` は共通素材で、必要ならこの締めカードの前後に差し込みます。
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={presentationProfile.closingCardEnabled}
                  onChange={(e) =>
                    setPresentationProfile((prev) => ({
                      ...prev,
                      closingCardEnabled: e.target.checked,
                    }))
                  }
                  disabled={isRendering || isPreviewing}
                />
                締めカードを含める
              </label>

              <div className="grid gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    見出し
                  </label>
                  <input
                    type="text"
                    value={presentationProfile.closingCardHeadline}
                    onChange={(e) =>
                      setPresentationProfile((prev) => ({
                        ...prev,
                        closingCardHeadline: e.target.value,
                      }))
                    }
                    className="nv-input"
                    disabled={isRendering || isPreviewing}
                    placeholder="ご視聴ありがとうございました"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    CTA
                  </label>
                  <input
                    type="text"
                    value={presentationProfile.closingCardCtaText}
                    onChange={(e) =>
                      setPresentationProfile((prev) => ({
                        ...prev,
                        closingCardCtaText: e.target.value,
                      }))
                    }
                    className="nv-input"
                    disabled={isRendering || isPreviewing}
                    placeholder="続きは概要欄から確認してください"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    出典表示
                  </label>
                  <select
                    value={presentationProfile.sourceDisplayMode}
                    onChange={(e) =>
                      setPresentationProfile((prev) => ({
                        ...prev,
                        sourceDisplayMode: e.target.value as typeof prev.sourceDisplayMode,
                      }))
                    }
                    className="nv-input"
                    disabled={isRendering || isPreviewing}
                  >
                    {Object.entries(SOURCE_DISPLAY_MODE_LABELS).map(([mode, label]) => (
                      <option key={mode} value={mode}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {presentationProfile.sourceDisplayMode === 'custom' && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      カスタム出典表記
                    </label>
                    <input
                      type="text"
                      value={presentationProfile.sourceDisplayText}
                      onChange={(e) =>
                        setPresentationProfile((prev) => ({
                          ...prev,
                          sourceDisplayText: e.target.value,
                        }))
                      }
                      className="nv-input"
                      disabled={isRendering || isPreviewing}
                      placeholder="出典: 社内広報資料"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-[10px] border border-[var(--nv-color-border)] bg-white p-3">
                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  <Badge tone={presentationProfile.closingCardEnabled ? 'success' : 'neutral'}>
                    {presentationProfile.closingCardEnabled ? '締めカードあり' : '締めカードなし'}
                  </Badge>
                  <Badge tone="info">{SOURCE_DISPLAY_MODE_LABELS[presentationProfile.sourceDisplayMode]}</Badge>
                  {renderOptions.includeEnding && <Badge tone="neutral">後段に ending 動画を連結</Badge>}
                </div>
                <div className="space-y-2 text-xs text-slate-600">
                  <div>
                    <div className="font-semibold text-slate-700">見出しプレビュー</div>
                    <div className="mt-1 text-sm text-slate-900">
                      {presentationProfile.closingCardHeadline.trim() || '未設定'}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">CTA プレビュー</div>
                    <div className="mt-1 text-sm text-slate-900">
                      {presentationProfile.closingCardCtaText.trim() || 'なし'}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">出典プレビュー</div>
                    <div className="mt-1 text-sm text-slate-900">{closingSourcePreview ?? 'なし'}</div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card
            title="今回の書き出し設定"
            subtitle="品質は app settings、付加素材は今回の書き出しで切り替え"
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  navigate('/settings', {
                    state: { returnTo: projectId ? `/projects/${projectId}/video` : '/projects' },
                  })
                }
              >
                設定を開く
              </Button>
            }
          >
            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-[10px] border border-[var(--nv-color-border)] bg-slate-50 p-3">
                <div className="grid gap-2 sm:grid-cols-2 text-xs text-slate-600">
                  <div>
                    <div className="font-semibold text-slate-700">既定解像度</div>
                    <div className="mt-1 text-sm text-slate-900">{renderOptions.resolution}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">既定FPS</div>
                    <div className="mt-1 text-sm text-slate-900">{renderOptions.fps}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">既定動画ビットレート</div>
                    <div className="mt-1 text-sm text-slate-900">{renderOptions.videoBitrate}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">既定音声ビットレート</div>
                    <div className="mt-1 text-sm text-slate-900">{renderOptions.audioBitrate}</div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  これらは設定画面の既定値です。動画ページでは今回の出力先と付加動画だけを切り替えます。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={renderOptions.includeOpening}
                    onChange={(e) =>
                      setRenderOptions((prev) => ({
                        ...prev,
                        includeOpening: e.target.checked,
                      }))
                    }
                    disabled={!settings.openingVideoPath || isRendering || isPreviewing}
                  />
                  オープニングを含める
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={renderOptions.includeEnding}
                    onChange={(e) =>
                      setRenderOptions((prev) => ({
                        ...prev,
                        includeEnding: e.target.checked,
                      }))
                    }
                    disabled={!settings.endingVideoPath || isRendering || isPreviewing}
                  />
                  エンディングを含める
                </label>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  現在の保存先
                </label>
                <div className="space-y-2">
                  <div className="rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 px-3 py-2 font-mono text-[11px] leading-5 text-slate-600 break-all">
                    {outputPath.trim() || '未設定'}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      onClick={handleSelectOutputDir}
                      disabled={isRendering || isPreviewing}
                      className="whitespace-nowrap"
                    >
                      場所を選択
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleRevealOutput}
                      disabled={!outputPath.trim()}
                      className="whitespace-nowrap"
                    >
                      Finderで表示
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  出力ファイル名はプロジェクト名から自動で付与されます。
                </p>
              </div>
            </div>
          </Card>

          <Card title="公開前チェック" subtitle="書き出し前に確認">
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-center justify-between">
                <span>全パート音声生成</span>
                <StatusChip
                  tone={missingAudioCount === 0 ? 'success' : 'warning'}
                  label={missingAudioCount === 0 ? 'OK' : '未完了'}
                />
              </li>
              <li className="flex items-center justify-between">
                <span>全パート画像割り当て</span>
                <StatusChip
                  tone={missingImagesCount === 0 ? 'success' : 'warning'}
                  label={missingImagesCount === 0 ? 'OK' : '未完了'}
                />
              </li>
              <li className="flex items-center justify-between">
                <span>出力先指定</span>
                <StatusChip
                  tone={outputPath.trim() ? 'success' : 'warning'}
                  label={outputPath.trim() ? 'OK' : '未指定'}
                />
              </li>
            </ul>
          </Card>
        </div>
      </div>

      {showProgress && progress && (isRendering || isPreviewing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="nv-surface w-full max-w-md p-5">
            <div className="mb-2 text-base font-semibold text-slate-900">
              {isRendering ? '動画を書き出し中...' : 'プレビュー生成中...'}
            </div>
            <div className="mb-3 text-sm text-slate-600">
              {progress.message || progress.stage || '処理中'}
            </div>
            <ProgressBar value={Math.min(100, Math.max(0, progress.percent ?? 0))} max={100} />
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <div>{typeof progress.percent === 'number' ? `${progress.percent}%` : ''}</div>
              {typeof progress.current === 'number' && typeof progress.total === 'number' && (
                <div>
                  {progress.current}/{progress.total}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={handleCancel}>
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
