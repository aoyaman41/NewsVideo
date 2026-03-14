import { useMemo, useState } from 'react';
import type { ImageAsset, ImageAssetRef } from '../../schemas';
import { ImageCard } from './ImageCard';
import { ImagePreviewModal } from './ImagePreviewModal';
import { Badge, Button, StatusChip } from '../ui';

interface ImageAssignmentProps {
  panelImages: ImageAssetRef[];
  candidateImages: ImageAsset[];
  getImageById: (imageId: string) => ImageAsset | undefined;
  onChange: (next: ImageAssetRef[]) => void;
  onDeleteImage?: (imageId: string) => void;
}

type SourceFilter = 'all' | 'generated' | 'imported';

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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const uniqueCandidates = useMemo(
    () =>
      normalizeCandidates(candidateImages).filter(
        (image) => image.id !== assignedImageId
      ).sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt)),
    [candidateImages, assignedImageId]
  );
  const filteredCandidates = useMemo(() => {
    if (sourceFilter === 'all') return uniqueCandidates;
    return uniqueCandidates.filter((image) => image.sourceType === sourceFilter);
  }, [sourceFilter, uniqueCandidates]);
  const generatedCount = useMemo(
    () => uniqueCandidates.filter((image) => image.sourceType === 'generated').length,
    [uniqueCandidates]
  );
  const importedCount = useMemo(
    () => uniqueCandidates.filter((image) => image.sourceType === 'imported').length,
    [uniqueCandidates]
  );

  const handleSelect = (imageId: string) => {
    onChange([{ imageId }]);
  };

  const handleClear = () => {
    onChange([]);
  };

  return (
    <div className="space-y-4">
      <div className="nv-surface-muted flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={assignedImageId ? 'success' : 'warning'} label="1パート1枚" />
          <Badge tone="neutral">候補 {uniqueCandidates.length}</Badge>
        </div>
        <div className="text-xs text-slate-600">
          使用中 <span className="font-semibold">{assignedImageId ? '1' : '0'}</span> / 1
        </div>
      </div>

      {hasLegacyMultiple && (
        <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          旧データのため複数画像が設定されています。現在の書き出しでは先頭1枚のみ使用されます。
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <section className="nv-surface-muted h-fit p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold tracking-wide text-slate-500">使用中</h4>
            {assignedImageId ? <Badge tone="success">設定済み</Badge> : <Badge tone="warning">未設定</Badge>}
          </div>

          {assignedImageId ? (
            assignedImage ? (
              <ImageCard
                image={assignedImage}
                isSelected
                clickMode="preview"
                onPreview={() => setPreviewImageId(assignedImageId)}
              />
            ) : (
              <div className="rounded-[8px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                画像が見つかりません
              </div>
            )
          ) : (
            <div className="rounded-[8px] border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-xs text-slate-500">
              候補から1枚選択してください
            </div>
          )}

          {assignedImageId && (
            <Button variant="secondary" size="sm" block className="mt-2" onClick={handleClear}>
              割り当て解除
            </Button>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">候補画像</h4>
              <p className="text-xs text-slate-500">
                カードをクリックで即割り当て。拡大確認は右上のアイコンから。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1 rounded-[8px] border border-[var(--nv-color-border)] bg-white p-1">
              {(
                [
                  { key: 'all', label: `すべて ${uniqueCandidates.length}` },
                  { key: 'generated', label: `AI ${generatedCount}` },
                  { key: 'imported', label: `取込 ${importedCount}` },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSourceFilter(option.key)}
                  className={`rounded-[8px] px-2 py-1 text-xs font-semibold transition-colors ${
                    sourceFilter === option.key
                      ? 'bg-[var(--nv-color-accent)] text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {filteredCandidates.length === 0 ? (
            <div className="rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 px-3 py-12 text-center text-sm text-slate-500">
              {uniqueCandidates.length === 0
                ? '候補画像がありません（先に画像を生成してください）'
                : 'このフィルタに一致する候補画像がありません'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredCandidates.map((image) => (
                <ImageCard
                  key={image.id}
                  image={image}
                  isSelected={assignedImageId === image.id}
                  clickMode="select"
                  onSelect={() => handleSelect(image.id)}
                  selectLabel="割り当てる"
                  selectTone="primary"
                  onPreview={() => setPreviewImageId(image.id)}
                  onDelete={onDeleteImage ? () => onDeleteImage(image.id) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {assignedImageId && !assignedImage && (
        <div className="rounded-[8px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          参照中の画像ファイルが見つからないため、別画像を割り当てるか解除してください。
          <div className="mt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClear}
              className="border-red-200 text-red-700 hover:bg-red-100"
            >
              割り当て解除
            </Button>
          </div>
        </div>
      )}

      <ImagePreviewModal
        image={previewImageId ? getImageById(previewImageId) ?? null : null}
        open={previewImageId != null}
        onClose={() => setPreviewImageId(null)}
      />
    </div>
  );
}
