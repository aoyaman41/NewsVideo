import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import type { Project } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';

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
  const location = useLocation();

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

  const missingAudioCount = useMemo(() => {
    if (!project) return 0;
    return project.parts.filter((p) => !p.audio).length;
  }, [project]);

  const missingImagesCount = useMemo(() => {
    if (!project) return 0;
    return project.parts.filter((p) => (p.panelImages?.length ?? 0) === 0).length;
  }, [project]);

  const selectedPart = useMemo(() => {
    return project?.parts.find((p) => p.id === selectedPartId) ?? null;
  }, [project, selectedPartId]);

  const videoSrc = useMemo(() => (videoPath ? toLocalFileUrl(videoPath) : null), [videoPath]);

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
      } catch (err) {
        console.error('Failed to load project/settings:', err);
        setError(err instanceof Error ? err.message : '読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [projectId]);

  const handleSelectOutputDir = useCallback(async () => {
    if (!project) return;
    const dir = await window.electronAPI.file.selectDirectory();
    if (!dir) return;
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'output';
    setOutputPath(`${dir}/${safeName}.mp4`);
  }, [project]);

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
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (!project || !settings) {
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
        title="動画プレビュー"
        subtitle={project.name}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/projects/${projectId}/audio`)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              音声生成に戻る
            </button>
            <button
              onClick={() => navigate('/settings', { state: { returnTo: `${location.pathname}${location.search}` } })}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              設定
            </button>
          </div>
        }
      />

      {projectId && <WorkflowNav projectId={projectId} current="video" project={project} />}

      {error && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 左: パート一覧 */}
        <div className="w-72 border-r border-gray-200 overflow-auto bg-gray-50">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-2">パート一覧</h3>
            <div className="text-xs text-gray-500 space-y-1 mb-4">
              <div>音声未生成: {missingAudioCount} / {project.parts.length}</div>
              <div>画像未割り当て: {missingImagesCount} / {project.parts.length}</div>
            </div>

            <ul className="space-y-2">
              {project.parts.map((part, idx) => {
                const hasAudio = Boolean(part.audio);
                const hasImages = (part.panelImages?.length ?? 0) > 0;
                return (
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
                        <span className="text-xs font-medium text-gray-400">{idx + 1}</span>
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {part.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs ${hasAudio ? 'text-green-600' : 'text-orange-600'}`}>
                          {hasAudio ? '✓ 音声' : '⚠ 音声'}
                        </span>
                        <span className="text-xs text-gray-400">|</span>
                        <span className={`text-xs ${hasImages ? 'text-green-600' : 'text-orange-600'}`}>
                          {hasImages ? `✓ 画像${part.panelImages.length}` : '⚠ 画像0'}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 space-y-2">
              <button
                onClick={handleGeneratePreview}
                disabled={isPreviewing || isRendering || !selectedPartId}
                className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPreviewing ? 'プレビュー生成中...' : '選択パートをプレビュー'}
              </button>
              <button
                onClick={handleRender}
                disabled={isRendering || isPreviewing || project.parts.length === 0}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRendering ? '書き出し中...' : '動画を書き出し'}
              </button>
              {(isRendering || isPreviewing) && (
                <button
                  onClick={handleCancel}
                  className="w-full px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100"
                >
                  キャンセル
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 右: プレビュー / 設定 */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-900">プレビュー</h3>
              {selectedPart && (
                <div className="text-sm text-gray-600 truncate max-w-[60%]">
                  {selectedPart.index + 1}. {selectedPart.title}
                </div>
              )}
            </div>
            <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
              {videoSrc ? (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  className="w-full h-full"
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
                <div className="w-full h-full flex items-center justify-center text-gray-300 text-sm">
                  プレビューを生成するとここに表示されます
                </div>
              )}
            </div>
            {mediaError && (
              <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                {mediaError}
              </div>
            )}
            {mediaDebug && (
              <div className="mt-2 bg-gray-50 border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-xs break-all">
                {mediaDebug}
              </div>
            )}
            {videoPath && (
              <div className="mt-3 text-xs text-gray-500 break-all">
                {videoPath}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">出力設定</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">解像度</label>
                <select
                  value={renderOptions.resolution}
                  onChange={(e) =>
                    setRenderOptions((prev) => ({
                      ...prev,
                      resolution: e.target.value as RenderOptions['resolution'],
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isRendering || isPreviewing}
                >
                  <option value="1920x1080">1920x1080 (Full HD)</option>
                  <option value="1280x720">1280x720 (HD)</option>
                  <option value="3840x2160">3840x2160 (4K)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">FPS</label>
                <select
                  value={renderOptions.fps}
                  onChange={(e) =>
                    setRenderOptions((prev) => ({
                      ...prev,
                      fps: Number(e.target.value),
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isRendering || isPreviewing}
                >
                  <option value={24}>24</option>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">動画ビットレート</label>
                <input
                  type="text"
                  value={renderOptions.videoBitrate}
                  onChange={(e) =>
                    setRenderOptions((prev) => ({
                      ...prev,
                      videoBitrate: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isRendering || isPreviewing}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">音声ビットレート</label>
                <input
                  type="text"
                  value={renderOptions.audioBitrate}
                  onChange={(e) =>
                    setRenderOptions((prev) => ({
                      ...prev,
                      audioBitrate: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isRendering || isPreviewing}
                />
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  オープニング / エンディング
                </label>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-2">
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
                  <label className="flex items-center gap-2">
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
                  {!settings.openingVideoPath && (
                    <span className="text-xs text-gray-500">
                      ※オープニング動画は設定画面で指定できます
                    </span>
                  )}
                </div>
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">出力先</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                    disabled={isRendering || isPreviewing}
                  />
                  <button
                    type="button"
                    onClick={handleSelectOutputDir}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                    disabled={isRendering || isPreviewing}
                  >
                    参照
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  生成に時間がかかる場合があります。ffmpeg が未インストールの場合はエラーになります。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 進捗モーダル */}
      {showProgress && progress && (isRendering || isPreviewing) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-full max-w-md p-6">
            <div className="text-lg font-semibold text-gray-900 mb-2">
              {isRendering ? '動画を書き出し中...' : 'プレビュー生成中...'}
            </div>
            <div className="text-sm text-gray-600 mb-4">
              {progress.message || progress.stage || '処理中'}
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.max(0, progress.percent ?? 0))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500">
              <div>{typeof progress.percent === 'number' ? `${progress.percent}%` : ''}</div>
              {typeof progress.current === 'number' && typeof progress.total === 'number' && (
                <div>
                  {progress.current}/{progress.total}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
