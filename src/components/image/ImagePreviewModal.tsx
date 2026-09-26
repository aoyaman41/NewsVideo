import { useModalFocus } from '../../hooks/useModalFocus';
import type { ImageAsset } from '../../schemas';
import { toLocalFileUrl } from '../../utils/toLocalFileUrl';
import { Button } from '../ui';

interface ImagePreviewModalProps {
  image: ImageAsset | null;
  open: boolean;
  onClose: () => void;
}

export function ImagePreviewModal({ image, open, onClose }: ImagePreviewModalProps) {
  const ref = useModalFocus(open, onClose);

  if (!open || !image) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nv-color-text)]/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="画像の拡大表示"
      ref={ref}
      tabIndex={-1}
    >
      <div
        className="nv-surface flex max-h-[90vh] w-[92vw] max-w-5xl flex-col overflow-hidden shadow-[var(--nv-shadow-md)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--nv-color-border)] px-4 py-2">
          <div className="text-sm text-[var(--nv-color-muted)]">
            {image.sourceType === 'generated' ? 'AI で作成' : '取り込み画像'}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            閉じる
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-3">
          <img
            src={toLocalFileUrl(image.filePath)}
            alt="拡大した画像"
            className="max-h-[78vh] max-w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}
