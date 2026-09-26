import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project, Part } from '../../schemas';
import { toLocalFileUrl } from '../../utils/toLocalFileUrl';
import { withRenderConflictRetry } from '../../utils/renderRetry';
import { Button, Card } from '../ui';
import { loadForPreview } from '../common/renderPrep';
import { JOB_ACTIVE_MESSAGE } from '../common/useJobActive';

/** 台本画面の右側に出す、このシーンの画像・音声と動画のプレビュー */
export function ScenePreview({
  project,
  part,
  jobActive,
  onError,
}: {
  project: Project;
  part: Part;
  jobActive: boolean;
  onError: (error: unknown) => void;
}) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState('');
  const [previewVersion, setPreviewVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  const images = [...project.images, ...project.article.importedImages];
  const firstImage = part.panelImages[0]
    ? images.find((image) => image.id === part.panelImages[0].imageId)
    : undefined;
  const moreImages = Math.max(0, part.panelImages.length - 1);

  const blockedReason = jobActive
    ? JOB_ACTIVE_MESSAGE
    : !part.audio && part.panelImages.length === 0
      ? '画像と音声ができると、動画で確認できます。'
      : !part.audio
        ? '音声ができると、動画で確認できます。'
        : part.panelImages.length === 0
          ? '画像ができると、動画で確認できます。'
          : null;

  const renderPreview = async () => {
    setBusy(true);
    try {
      const result = await withRenderConflictRetry(project.id, async () => {
        const intended = await loadForPreview(project.id);
        return window.electronAPI.video.preview(part.id, intended);
      });
      setPreview(result.previewPath);
      setPreviewVersion(Date.now());
    } catch (failure) {
      onError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="このシーンの画像と音声">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-[var(--nv-radius-sm)] bg-[var(--nv-color-canvas)]">
          {preview ? (
            <video
              controls
              src={`${toLocalFileUrl(preview)}?v=${previewVersion}`}
              className="aspect-video w-full bg-black"
            />
          ) : firstImage ? (
            <img
              src={toLocalFileUrl(firstImage.filePath)}
              alt="このシーンの 1 枚目の画像"
              className="aspect-video w-full bg-black object-contain"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center text-sm text-[var(--nv-color-muted)]">
              画像はまだありません
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="nv-help">
            画像 {part.panelImages.length} 枚{moreImages > 0 ? '(順に切り替わります)' : ''}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/projects/${project.id}/image`)}
          >
            画像を変える
          </Button>
        </div>

        <div className="space-y-1">
          {part.audio ? (
            <audio
              aria-label="このシーンの音声"
              controls
              src={toLocalFileUrl(part.audio.filePath)}
              className="w-full"
            />
          ) : (
            <p className="nv-help">音声はまだありません。</p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/projects/${project.id}/audio`)}
            >
              音声を変える
            </Button>
          </div>
        </div>

        <div className="space-y-1 border-t border-[var(--nv-color-border)] pt-3">
          <Button
            size="sm"
            variant="secondary"
            block
            disabled={busy || Boolean(blockedReason)}
            onClick={() => void renderPreview()}
          >
            {busy ? 'プレビューを作っています…' : 'このシーンを動画で確認'}
          </Button>
          {blockedReason && <p className="nv-help">{blockedReason}</p>}
        </div>
      </div>
    </Card>
  );
}
