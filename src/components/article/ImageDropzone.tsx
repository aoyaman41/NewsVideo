import { toLocalFileUrl } from '../../utils/toLocalFileUrl';
import { useCallback, useState } from 'react';
import { useDropzone, type FileWithPath } from 'react-dropzone';
import type { ImageAsset } from '../../schemas';
import { ImageTagEditor } from '../common/ImageTagEditor';
import { FriendlyError } from '../errors/FriendlyError';

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
  '人物',
  '風景',
  '建物',
  'グラフ',
  '図解',
  'ロゴ',
  '記者会見',
  'インタビュー',
  '街頭',
  'オフィス',
  '工場',
  'イベント',
  'スポーツ',
  '政治',
  '経済',
  'テクノロジー',
];

export function ImageDropzone({
  images,
  projectId,
  onImagesAdded,
  onImageRemoved,
  onImageTagsUpdate,
  blobUrlMap = new Map(),
}: ImageDropzoneProps) {
  const [importError, setImportError] = useState<unknown>(null);
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
          const imageAsset = await window.electronAPI.image.importData(
            await file.arrayBuffer(),
            projectId
          );

          newImages.push(imageAsset);
          newBlobUrls.set(imageAsset.id, blobUrl);
        } catch (error) {
          setImportError(error);
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
      {importError !== null && (
        <FriendlyError
          title="写真を追加できませんでした"
          error={importError}
          onDismiss={() => setImportError(null)}
        />
      )}
      {/* ドロップゾーン */}
      <div
        {...getRootProps()}
        className={`nv-focus-ring cursor-pointer rounded-[var(--nv-radius-md)] border-2 border-dashed p-6 text-center transition-colors ${
          isDragActive
            ? 'border-[var(--nv-color-accent)] bg-[var(--nv-color-canvas)]'
            : 'border-[var(--nv-color-border)] hover:border-[var(--nv-color-accent)]'
        }`}
      >
        <input {...getInputProps()} />
        <div className="text-[var(--nv-color-muted)]">
          <svg
            className="mx-auto mb-3 h-10 w-10 text-[var(--nv-color-muted)]"
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
              <p className="mb-1 text-sm font-semibold text-[var(--nv-color-text)]">
                写真をここにドラッグ&ドロップ
              </p>
              <p className="text-xs">またはクリックして選択(PNG・JPEG・GIF・WebP)</p>
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
              className={`group relative overflow-hidden rounded-[var(--nv-radius-sm)] border-2 bg-[var(--nv-color-canvas)] transition-colors ${
                selectedImageId === image.id
                  ? 'border-[var(--nv-color-accent)]'
                  : 'border-[var(--nv-color-border)]'
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
                type="button"
                aria-label="この写真を外す"
                title="この写真を外す"
                onClick={(e) => {
                  e.stopPropagation();
                  onImageRemoved(image.id);
                }}
                className="nv-focus-ring absolute top-2 right-2 rounded-full bg-[var(--nv-color-danger)] p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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
              <div className="bg-[var(--nv-color-surface)] p-2">
                <div className="mb-1 text-xs text-[var(--nv-color-muted)]">
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
