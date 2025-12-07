import type { ImageAsset } from '../../schemas';
import { ImageCard } from './ImageCard';

interface ImageGalleryProps {
  images: ImageAsset[];
  selectedImageIds?: string[];
  onSelectImage?: (imageId: string) => void;
  onDeleteImage?: (imageId: string) => void;
  emptyMessage?: string;
  title?: string;
  showGenerateButton?: boolean;
  onGenerate?: () => void;
  isGenerating?: boolean;
}

export function ImageGallery({
  images,
  selectedImageIds = [],
  onSelectImage,
  onDeleteImage,
  emptyMessage = '画像がありません',
  title,
  showGenerateButton = false,
  onGenerate,
  isGenerating = false,
}: ImageGalleryProps) {
  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      {(title || showGenerateButton) && (
        <div className="flex items-center justify-between">
          {title && (
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          )}
          {showGenerateButton && onGenerate && (
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  生成中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  画像を生成
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* 画像グリッド */}
      {images.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg">
          <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {images.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              isSelected={selectedImageIds.includes(image.id)}
              onSelect={onSelectImage ? () => onSelectImage(image.id) : undefined}
              onDelete={onDeleteImage ? () => onDeleteImage(image.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
