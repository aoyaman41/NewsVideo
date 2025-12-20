import { useEffect } from 'react';
import type { ImageAsset } from '../../schemas';
import { toLocalFileUrl } from '../../utils/toLocalFileUrl';

interface ImagePreviewModalProps {
  image: ImageAsset | null;
  open: boolean;
  onClose: () => void;
}

export function ImagePreviewModal({ image, open, onClose }: ImagePreviewModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !image) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-5xl w-[92vw] max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="text-sm text-gray-600">
            {image.sourceType === 'generated' ? 'AI生成' : 'インポート'} / {image.metadata.width}×{image.metadata.height}
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
          >
            閉じる
          </button>
        </div>
        <div className="bg-black flex items-center justify-center p-3">
          <img
            src={toLocalFileUrl(image.filePath)}
            alt=""
            className="max-h-[80vh] max-w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}
