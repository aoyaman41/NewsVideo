import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { Badge, Button, Card, ProgressBar, StatusChip } from '../components/ui';
import type { AutoGenerationStatus, Project } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';
import { summarizeProjectProgress } from '../utils/projectHealth';

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

export function VideoManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

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
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaDebug, setMediaDebug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastVideoPathRef = useRef<string | null>(null);

  const resolveExistingVideoPath = useCallback(async (project: Project) => {
    const lastPath = project.autoGenerationStatus?.lastVideoPath;
    if (lastPath) {
      try {
        const exists = await window.electronAPI.file.exists(lastPath);
        if (exists) return lastPath;
      } catch {
        return lastPath;
      }
    }

    try {
      const outputDir = `${project.path}/output`;
      const entries = await window.electronAPI.file.listFiles(outputDir);
      const candidates = entries
        .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith('.mp4'))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      const latest = candidates[0]?.path ?? null;
      if (latest) return latest;
      if (lastPath) return lastPath;
      return null;
    } catch {
      return lastPath ?? null;
    }
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

  const selectedPart = useMemo(() => {
    return project?.parts.find((p) => p.id === selectedPartId) ?? null;
  }, [project, selectedPartId]);

  const videoSrc = useMemo(() => (videoPath ? toLocalFileUrl(videoPath) : null), [videoPath]);

  useEffect(() => {
    lastVideoPathRef.current = videoPath;
  }, [videoPath]);

  // src が同一のまま更新されるケースに備えて明示的に load する
  useEffect(() => {
    if (!videoPath) return;
    setMediaError(null);
    setMediaDebug(null);
    const el = videoRef.current;
    el?.load();
  }, [videoPath]);

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

        setProject(loadedProject);
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

        setSelectedPartId(loadedProject.parts[0]?.id ?? null);

        const defaults: RenderOptions = {
          resolution: normalizedSettings.videoResolution,
          fps: normalizedSettings.videoFps,
          videoBitrate: normalizedSettings.videoBitrate,
          audioBitrate: normalizedSettings.audioBitrate,
          includeOpening: Boolean(normalizedSettings.openingVideoPath),
          includeEnding: Boolean(normalizedSettings.endingVideoPath),
        };
        setRenderOptions(defaults);

        const safeName = loadedProject.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'output';
        setOutputPath(`${loadedProject.path}/output/${safeName}.mp4`);

        const existingVideoPath = await resolveExistingVideoPath(loadedProject);
        if (existingVideoPath) {
          setVideoPath(existingVideoPath);
          if (existingVideoPath !== loadedProject.autoGenerationStatus?.lastVideoPath) {
            const now = new Date().toISOString();
            const current = loadedProject.autoGenerationStatus;
            const nextStatus: AutoGenerationStatus = {
              running: current?.running ?? false,
              step: current?.running ? current?.step : (current?.step ?? '完了'),
              startedAt: current?.startedAt,
              updatedAt: now,
              finishedAt: current?.running ? current?.finishedAt : now,
              cancelRequested: current?.cancelRequested,
              error: current?.error,
              steps: { ...(current?.steps ?? {}), video: true },
              lastVideoPath: existingVideoPath,
            };
            const updatedProject: Project = {
              ...loadedProject,
              autoGenerationStatus: nextStatus,
              updatedAt: now,
            };
            await window.electronAPI.project.save(updatedProject);
            setProject(updatedProject);
          }
        }
      } catch (err) {
        console.error('Failed to load project/settings:', err);
        setError(err instanceof Error ? err.message : '読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [projectId, resolveExistingVideoPath]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (isRendering || isPreviewing) return;
      try {
        const latest = await window.electronAPI.project.load(projectId);
        if (cancelled) return;
        setProject(latest);
        const candidate = await resolveExistingVideoPath(latest);
        if (candidate && candidate !== lastVideoPathRef.current) {
          setVideoPath(candidate);
        }
      } catch {
        // ignore
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, resolveExistingVideoPath, isRendering, isPreviewing]);

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
      setVideoPath(res.previewPath);
      // 先頭から再生できるように
      setTimeout(() => {
        if (videoRef.current) videoRef.current.currentTime = 0;
      }, 0);
    } catch (err) {
      console.error('Failed to generate preview:', err);
      setError(err instanceof Error ? err.message : 'プレビュー生成に失敗しました');
    } finally {
      setIsPreviewing(false);
    }
  }, [selectedPartId]);

  const handleRender = useCallback(async () => {
    if (!project) return;
    if (!outputPath.trim()) {
      setError('出力先が未指定です');
      return;
    }

    try {
      setIsRendering(true);
      setError(null);
      setShowProgress(true);
      setProgress({ stage: 'preparing', percent: 0, message: '準備中...' });

      const res = await window.electronAPI.video.render(project, renderOptions, outputPath.trim());
      setVideoPath(res.outputPath);
      try {
        const now = new Date().toISOString();
        const current = project.autoGenerationStatus;
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
          ...project,
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
      setError(err instanceof Error ? err.message : '動画書き出しに失敗しました');
    } finally {
      setIsRendering(false);
    }
  }, [outputPath, project, renderOptions]);

  const handleCancel = useCallback(async () => {
    try {
      await window.electronAPI.video.cancelRender();
      setShowProgress(false);
      setIsRendering(false);
      setIsPreviewing(false);
      setError('キャンセルしました');
    } catch (err) {
      console.warn('Failed to cancel render:', err);
    }
  }, []);

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
        title="動画"
        subtitle={project.name}
        statusLabel={
          summary ? `未音声 ${summary.missingAudio} / 未画像 ${summary.missingImages}` : undefined
        }
        statusTone={missingAudioCount + missingImagesCount > 0 ? 'warning' : 'success'}
      />

      {projectId && <WorkflowNav projectId={projectId} current="video" project={project} />}

      {error && (
        <div className="mx-4 mt-4 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
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
              <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {mediaError}
              </div>
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
          <Card title="出力設定" subtitle="品質と出力先を指定">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">解像度</label>
                <select
                  value={renderOptions.resolution}
                  onChange={(e) =>
                    setRenderOptions((prev) => ({
                      ...prev,
                      resolution: e.target.value as RenderOptions['resolution'],
                    }))
                  }
                  className="nv-input"
                  disabled={isRendering || isPreviewing}
                >
                  <option value="1920x1080">1920x1080 (Full HD)</option>
                  <option value="1280x720">1280x720 (HD)</option>
                  <option value="3840x2160">3840x2160 (4K)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">FPS</label>
                <select
                  value={renderOptions.fps}
                  onChange={(e) =>
                    setRenderOptions((prev) => ({
                      ...prev,
                      fps: Number(e.target.value),
                    }))
                  }
                  className="nv-input"
                  disabled={isRendering || isPreviewing}
                >
                  <option value={24}>24</option>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  動画ビットレート
                </label>
                <input
                  type="text"
                  value={renderOptions.videoBitrate}
                  onChange={(e) =>
                    setRenderOptions((prev) => ({
                      ...prev,
                      videoBitrate: e.target.value,
                    }))
                  }
                  className="nv-input"
                  disabled={isRendering || isPreviewing}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  音声ビットレート
                </label>
                <input
                  type="text"
                  value={renderOptions.audioBitrate}
                  onChange={(e) =>
                    setRenderOptions((prev) => ({
                      ...prev,
                      audioBitrate: e.target.value,
                    }))
                  }
                  className="nv-input"
                  disabled={isRendering || isPreviewing}
                />
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
                <label className="mb-1 block text-xs font-semibold text-slate-600">出力先</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    className="nv-input font-mono text-xs"
                    disabled={isRendering || isPreviewing}
                  />
                  <Button
                    variant="secondary"
                    onClick={handleSelectOutputDir}
                    disabled={isRendering || isPreviewing}
                  >
                    参照
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleRevealOutput}
                    disabled={!outputPath.trim()}
                  >
                    Finder
                  </Button>
                </div>
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
