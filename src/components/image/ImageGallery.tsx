import { useMemo, useState } from 'react';
import type { ImageAsset } from '../../schemas';
import { ImageCard } from './ImageCard';
import { ImagePreviewModal } from './ImagePreviewModal';

interface ImageGalleryProps {
  images: ImageAsset[];
  selectedImageIds?: string[];
  onSelectImage?: (imageId: string) => void;
  onDeleteImage?: (imageId: string) => void;
  emptyMessage?: string;
  selectLabel?: string;
  /** 選択中の画像のボタンの文言 */
  selectedLabel?: string;
}

export function ImageGallery({
  images,
  selectedImageIds = [],
  onSelectImage,
  onDeleteImage,
  emptyMessage = '画像がありません',
  selectLabel,
  selectedLabel,
}: ImageGalleryProps) {
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const previewImage = useMemo(
    () => images.find((img) => img.id === previewImageId) ?? null,
    [images, previewImageId]
  );

  return (
    <div>
      {images.length === 0 ? (
        <div className="rounded-[var(--nv-radius-sm)] border border-dashed border-[var(--nv-color-border)] bg-[var(--nv-color-canvas)] px-3 py-8 text-center text-sm text-[var(--nv-color-muted)]">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-4">
          {images.map((image) => {
            const selected = selectedImageIds.includes(image.id);
            return (
              <ImageCard
                key={image.id}
                image={image}
                isSelected={selected}
                onSelect={onSelectImage ? () => onSelectImage(image.id) : undefined}
                selectLabel={selected && selectedLabel ? selectedLabel : selectLabel}
                onPreview={() => setPreviewImageId(image.id)}
                onDelete={onDeleteImage ? () => onDeleteImage(image.id) : undefined}
              />
            );
          })}
        </div>
      )}

      <ImagePreviewModal
        image={previewImage}
        open={previewImage != null}
        onClose={() => setPreviewImageId(null)}
      />
    </div>
  );
}
