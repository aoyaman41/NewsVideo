import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ImageAsset } from '../../schemas';
import { ImageTagEditor } from '../common/ImageTagEditor';

interface ImageDropzoneProps {
  images: ImageAsset[];
  onImagesAdded: (images: ImageAsset[], blobUrls: Map<string, string>) => void;
  onImageRemoved: (imageId: string) => void;
  onImageTagsUpdate?: (imageId: string, tags: string[]) => void;
  blobUrlMap?: Map<string, string>;
}

// 推奨タグリスト（ニュース動画向け）
const SUGGESTED_TAGS = [
  '人物', '風景', '建物', 'グラフ', '図解', 'ロゴ',
  '記者会見', 'インタビュー', '街頭', 'オフィス', '工場',
  'イベント', 'スポーツ', '政治', '経済', 'テクノロジー',
];

export function ImageDropzone({ images, onImagesAdded, onImageRemoved, onImageTagsUpdate, blobUrlMap = new Map() }: ImageDropzoneProps) {
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const newImages: ImageAsset[] = [];
      const newBlobUrls = new Map<string, string>();

      for (const file of acceptedFiles) {
        // ファイルをArrayBufferとして読み込み
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // 画像のサイズを取得するためにImageを作成
        const blob = new Blob([uint8Array], { type: file.type });
        const blobUrl = URL.createObjectURL(blob);

        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.src = blobUrl;
        });

        const imageId = crypto.randomUUID();

        // 一時的なIDとパスを生成（実際の保存はメインプロセスで行う）
        const imageAsset: ImageAsset = {
          id: imageId,
          filePath: file.name, // 仮のパス（後でメインプロセスで更新）
          sourceType: 'imported',
          metadata: {
            width: img.width,
            height: img.height,
            mimeType: file.type,
            fileSize: file.size,
            createdAt: new Date().toISOString(),
            tags: [],
          },
        };

        newImages.push(imageAsset);
        newBlobUrls.set(imageId, blobUrl);
      }

      onImagesAdded(newImages, newBlobUrls);
    },
    [onImagesAdded]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
    },
  });

  return (
    <div className="space-y-4">
      {/* ドロップゾーン */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        <div className="text-gray-500">
          <svg
            className="w-12 h-12 mx-auto mb-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          {isDragActive ? (
            <p>ここにドロップしてください</p>
          ) : (
            <>
              <p className="mb-1">画像をドラッグ&ドロップ</p>
              <p className="text-sm">または クリックして選択</p>
            </>
          )}
        </div>
      </div>

      {/* 画像一覧 */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {images.map((image) => (
            <div
              key={image.id}
              className={`relative group bg-gray-100 rounded-lg overflow-hidden border-2 transition-colors ${
                selectedImageId === image.id ? 'border-blue-500' : 'border-transparent'
              }`}
              onClick={() => setSelectedImageId(selectedImageId === image.id ? null : image.id)}
            >
              {/* 画像 */}
              <div className="aspect-video">
                <img
                  src={blobUrlMap.get(image.id) || `file://${image.filePath}`}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              {/* 削除ボタン */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onImageRemoved(image.id);
                }}
                className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
              {/* メタ情報 */}
              <div className="p-2 bg-white">
                <div className="text-xs text-gray-500 mb-1">
                  {image.metadata.width} x {image.metadata.height}
                </div>
                {/* タグエディタ */}
                {onImageTagsUpdate && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <ImageTagEditor
                      image={image}
                      onTagsUpdate={onImageTagsUpdate}
                      suggestedTags={SUGGESTED_TAGS}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
