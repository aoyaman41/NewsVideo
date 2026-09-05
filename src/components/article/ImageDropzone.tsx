import { toLocalFileUrl } from '../../utils/toLocalFileUrl';
import { useCallback, useState } from 'react';
import { useDropzone, type FileWithPath } from 'react-dropzone';
import type { ImageAsset } from '../../schemas';
import { ImageTagEditor } from '../common/ImageTagEditor';

interface ImageDropzoneProps {
  images: ImageAsset[];
  projectId?: string;
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

export function ImageDropzone({
  images,
  projectId,
  onImagesAdded,
  onImageRemoved,
  onImageTagsUpdate,
  blobUrlMap = new Map(),
}: ImageDropzoneProps) {
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: FileWithPath[]) => {
      setImportError(null);
      const newImages: ImageAsset[] = [];
      const newBlobUrls = new Map<string, string>();

      for (const file of acceptedFiles) {
        // 画像プレビュー用のblob URLを作成
        const blobUrl = URL.createObjectURL(file);

        try {
          // 画像のサイズを取得
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
            img.src = blobUrl;
          });

          if (!projectId) throw new Error('保存先プロジェクトがありません。');
          const imageAsset = await window.electronAPI.image.importData(await file.arrayBuffer(), projectId);

          newImages.push(imageAsset);
          newBlobUrls.set(imageAsset.id, blobUrl);
        } catch (error) {
          setImportError(error instanceof Error ? error.message : String(error));
          URL.revokeObjectURL(blobUrl);
        }
      }

      if (newImages.length > 0) {
        onImagesAdded(newImages, newBlobUrls);
      }
    },
    [onImagesAdded, projectId]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
    },
  });

  return (
    <div className="space-y-4">
      {importError && <p role="alert" className="text-sm text-red-700">{importError}</p>}
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
                  src={blobUrlMap.get(image.id) || toLocalFileUrl(image.filePath)}
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
