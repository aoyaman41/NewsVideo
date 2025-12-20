import { useMemo, useState } from 'react';
import type { ImageAsset, ImageAssetRef } from '../../schemas';
import { ImageCard } from './ImageCard';
import { ImagePreviewModal } from './ImagePreviewModal';

interface ImageAssignmentProps {
  panelImages: ImageAssetRef[];
  candidateImages: ImageAsset[];
  getImageById: (imageId: string) => ImageAsset | undefined;
  onChange: (next: ImageAssetRef[]) => void;
  onDeleteImage?: (imageId: string) => void;
}

function normalizeCandidates(images: ImageAsset[]): ImageAsset[] {
  const seen = new Set<string>();
  const result: ImageAsset[] = [];
  for (const image of images) {
    if (seen.has(image.id)) continue;
    seen.add(image.id);
    result.push(image);
  }
  return result;
}

export function ImageAssignment({
  panelImages,
  candidateImages,
  getImageById,
  onChange,
  onDeleteImage,
}: ImageAssignmentProps) {
  const assignedImageId = panelImages[0]?.imageId;
  const assignedImage = assignedImageId ? getImageById(assignedImageId) : undefined;
  const hasLegacyMultiple = panelImages.length > 1;
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);

  const uniqueCandidates = useMemo(
    () =>
      normalizeCandidates(candidateImages).filter(
        (image) => image.id !== assignedImageId
      ),
    [candidateImages, assignedImageId]
  );

  const handleSelect = (imageId: string) => {
    onChange([{ imageId }]);
  };

  const handleClear = () => {
    onChange([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">画像の割り当て（1枚）</h3>
          <p className="text-sm text-gray-500">
            1パートにつき1枚を選択します。画像を分けたい場合はパートを分割してください。
          </p>
          {hasLegacyMultiple && (
            <p className="text-xs text-amber-600 mt-2">
              このパートは複数画像が設定されていますが、先頭1枚のみ使用します。
            </p>
          )}
        </div>
        <div className="text-sm text-gray-600">
          使用中: <span className="font-medium">{assignedImageId ? '1' : '0'}</span> / 1枚
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-900">使用画像</h4>
          {assignedImageId && (
            <button
              onClick={handleClear}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-md hover:bg-gray-50"
            >
              割り当て解除
            </button>
          )}
        </div>

        {assignedImageId ? (
          assignedImage ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <ImageCard
                image={assignedImage}
                isSelected
                onPreview={() => setPreviewImageId(assignedImageId)}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="text-sm font-medium text-red-700">画像が見つかりません</div>
              <div className="text-xs text-red-600 mt-1 break-all">ID: {assignedImageId}</div>
              <button
                onClick={handleClear}
                className="mt-3 px-3 py-1.5 text-sm bg-white text-red-700 border border-red-200 rounded-md hover:bg-red-50"
              >
                割り当て解除
              </button>
            </div>
          )
        ) : (
          <div className="p-8 text-center text-sm text-gray-500">
            候補画像から1枚を選択してください
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-900">候補画像</h4>
          <span className="text-xs text-gray-500">ボタンで設定</span>
        </div>

        {uniqueCandidates.length === 0 ? (
          <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
            候補画像がありません（先に画像を生成してください）
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {uniqueCandidates.map((image) => (
              <ImageCard
                key={image.id}
                image={image}
                isSelected={assignedImageId === image.id}
                onSelect={() => handleSelect(image.id)}
                selectLabel="使用する"
                selectTone="primary"
                onPreview={() => setPreviewImageId(image.id)}
                onDelete={onDeleteImage ? () => onDeleteImage(image.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <ImagePreviewModal
        image={previewImageId ? getImageById(previewImageId) ?? null : null}
        open={previewImageId != null}
        onClose={() => setPreviewImageId(null)}
      />
    </div>
  );
}
