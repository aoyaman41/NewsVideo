import type { ImageAsset } from '../../schemas';

// ローカルファイルパスをカスタムプロトコルURLに変換
function toLocalFileUrl(filePath: string): string {
  return `local-file://${encodeURIComponent(filePath)}`;
}

interface ImageCardProps {
  image: ImageAsset;
  isSelected?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
  isDraggable?: boolean;
}

export function ImageCard({
  image,
  isSelected = false,
  onSelect,
  onDelete,
  isDraggable = false,
}: ImageCardProps) {
  return (
    <div
      className={`relative group bg-gray-100 rounded-lg overflow-hidden border-2 transition-colors cursor-pointer ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-gray-300'
      } ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onClick={onSelect}
      draggable={isDraggable}
    >
      {/* 画像 */}
      <div className="aspect-video">
        <img
          src={toLocalFileUrl(image.filePath)}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            // 画像読み込みエラー時のフォールバック
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Crect fill="%23f3f4f6" width="100" height="100"/%3E%3Ctext fill="%239ca3af" font-family="Arial" font-size="12" x="50%" y="50%" text-anchor="middle" dy=".3em"%3ENo Image%3C/text%3E%3C/svg%3E';
          }}
        />
      </div>

      {/* ソースタイプバッジ */}
      <div className="absolute top-2 left-2">
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            image.sourceType === 'generated'
              ? 'bg-purple-100 text-purple-700'
              : 'bg-green-100 text-green-700'
          }`}
        >
          {image.sourceType === 'generated' ? 'AI生成' : 'インポート'}
        </span>
      </div>

      {/* 選択チェックマーク */}
      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      {/* 削除ボタン */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
          title="削除"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* メタ情報 */}
      <div className="p-2 bg-white border-t">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{image.metadata.width} x {image.metadata.height}</span>
          {image.metadata.tags.length > 0 && (
            <span className="text-blue-600">{image.metadata.tags.length}タグ</span>
          )}
        </div>
      </div>
    </div>
  );
}
