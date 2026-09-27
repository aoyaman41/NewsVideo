import { useMemo, useState } from 'react';
import type { ImageAsset, ImageAssetRef } from '../../schemas';
import { toLocalFileUrl } from '../../utils/toLocalFileUrl';
import { cx } from '../../utils/cx';
import { Button } from '../ui';
import { ImageCard } from './ImageCard';
import { ImagePreviewModal } from './ImagePreviewModal';
import {
  moveSlot,
  normalizeTarget,
  placeImage,
  removeSlot,
  setSlotDuration,
  type SlotTarget,
} from './panelSlots';

type SourceFilter = 'all' | 'generated' | 'imported';

interface SceneImagesProps {
  panelImages: ImageAssetRef[];
  candidateImages: ImageAsset[];
  getImageById: (imageId: string) => ImageAsset | undefined;
  target: SlotTarget;
  onTargetChange: (target: SlotTarget) => void;
  onChange: (next: ImageAssetRef[]) => void;
  onDeleteImage?: (imageId: string) => void;
  disabled?: boolean;
}

function uniqueById(images: ImageAsset[]): ImageAsset[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.id)) return false;
    seen.add(image.id);
    return true;
  });
}

/**
 * シーンで使う画像(書き出しでは並びのすべてを順に使う)と、候補の画像。
 * 候補を選ぶと、選択中の枠だけを差し替える。
 */
export function SceneImages({
  panelImages,
  candidateImages,
  getImageById,
  target,
  onTargetChange,
  onChange,
  onDeleteImage,
  disabled = false,
}: SceneImagesProps) {
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const slot = normalizeTarget(panelImages, target);
  const usedIds = useMemo(() => new Set(panelImages.map((ref) => ref.imageId)), [panelImages]);

  const candidates = useMemo(
    () =>
      uniqueById(candidateImages).sort((a, b) =>
        b.metadata.createdAt.localeCompare(a.metadata.createdAt)
      ),
    [candidateImages]
  );
  const generatedCount = candidates.filter((image) => image.sourceType === 'generated').length;
  const importedCount = candidates.length - generatedCount;
  const showFilter = generatedCount > 0 && importedCount > 0;
  const filtered =
    !showFilter || sourceFilter === 'all'
      ? candidates
      : candidates.filter((image) => image.sourceType === sourceFilter);

  const multiple = panelImages.length > 1;
  const targetLabel = slot === 'new' ? '新しい枠' : `${slot + 1} 枚目`;

  return (
    <div className="space-y-5">
      <section aria-labelledby="scene-images-heading" className="space-y-3">
        <div>
          <h4
            id="scene-images-heading"
            className="text-sm font-semibold text-[var(--nv-color-text)]"
          >
            動画で使う画像（{panelImages.length} 枚）
          </h4>
          <p className="nv-help mt-0.5">
            {multiple
              ? '書き出しでは、この順番で切り替わります。表示時間は音声の長さに合わせて自動で配分します。'
              : '画像を足すと、書き出しでは順番に切り替わります。'}
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-4">
          {panelImages.map((ref, index) => {
            const image = getImageById(ref.imageId);
            const active = slot === index;
            return (
              <li
                key={`${ref.imageId}-${index}`}
                className={cx(
                  'overflow-hidden rounded-[var(--nv-radius-sm)] border bg-white',
                  active
                    ? 'border-[var(--nv-color-accent)] ring-2 ring-[var(--nv-color-accent)]/25'
                    : 'border-[var(--nv-color-border)]'
                )}
              >
                <button
                  type="button"
                  onClick={() => onTargetChange(index)}
                  aria-pressed={active}
                  aria-label={`${index + 1} 枚目を差し替え先にする`}
                  className="nv-focus-ring relative block aspect-video w-full bg-[var(--nv-color-canvas)]"
                >
                  {image ? (
                    <img
                      src={toLocalFileUrl(image.filePath)}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center px-2 text-xs text-[var(--nv-color-danger)]">
                      画像ファイルが見つかりません
                    </span>
                  )}
                  <span
                    className={cx(
                      'absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold',
                      active
                        ? 'bg-[var(--nv-color-accent)] text-white'
                        : 'bg-white/90 text-[var(--nv-color-text)]'
                    )}
                  >
                    {index + 1} 枚目{active ? '・差し替え先' : ''}
                  </span>
                </button>
                <div className="space-y-2 border-t border-[var(--nv-color-border)] p-2">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      {multiple && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-2"
                            disabled={disabled || index === 0}
                            onClick={() => onChange(moveSlot(panelImages, index, -1))}
                            aria-label={`${index + 1} 枚目を前へ`}
                          >
                            ←
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-2"
                            disabled={disabled || index === panelImages.length - 1}
                            onClick={() => onChange(moveSlot(panelImages, index, 1))}
                            aria-label={`${index + 1} 枚目を後ろへ`}
                          >
                            →
                          </Button>
                        </>
                      )}
                      {image && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-2"
                          onClick={() => setPreviewImageId(image.id)}
                        >
                          拡大
                        </Button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="px-2 text-[var(--nv-color-danger)]"
                      disabled={disabled}
                      onClick={() => {
                        onChange(removeSlot(panelImages, index));
                        if (typeof slot !== 'number') return;
                        if (slot > index) onTargetChange(slot - 1);
                        else if (slot === index && index === panelImages.length - 1)
                          onTargetChange(Math.max(0, index - 1));
                      }}
                    >
                      外す
                    </Button>
                  </div>
                  {multiple && (
                    <label className="flex items-center gap-2 text-xs text-[var(--nv-color-muted)]">
                      表示秒数
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        placeholder="自動"
                        disabled={disabled}
                        className="nv-input h-8 px-2 py-1 text-xs"
                        value={ref.displayDurationSec ?? ''}
                        onChange={(event) =>
                          onChange(
                            setSlotDuration(
                              panelImages,
                              index,
                              event.target.value === '' ? undefined : Number(event.target.value)
                            )
                          )
                        }
                      />
                    </label>
                  )}
                </div>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => onTargetChange('new')}
              aria-pressed={slot === 'new'}
              disabled={disabled}
              className={cx(
                'nv-focus-ring flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-[var(--nv-radius-sm)] border border-dashed text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                slot === 'new'
                  ? 'border-[var(--nv-color-accent)] bg-[var(--nv-color-accent)]/10 text-[var(--nv-color-accent)]'
                  : 'border-[var(--nv-color-border)] bg-[var(--nv-color-canvas)] text-[var(--nv-color-muted)] hover:border-[var(--nv-color-accent)]'
              )}
            >
              <span className="text-lg leading-none">＋</span>
              <span className="font-semibold">
                {panelImages.length === 0 ? '1 枚目の枠' : '画像を足す'}
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section aria-labelledby="scene-candidates-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4
              id="scene-candidates-heading"
              className="text-sm font-semibold text-[var(--nv-color-text)]"
            >
              候補の画像
            </h4>
            <p className="nv-help mt-0.5">
              「使う」を押すと、{targetLabel}
              {slot === 'new' ? 'として最後に足します。' : 'に入ります。ほかの画像はそのままです。'}
            </p>
          </div>
          {showFilter && (
            <div
              role="group"
              aria-label="候補の絞り込み"
              className="flex items-center gap-1 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-border)] bg-white p-1"
            >
              {(
                [
                  { key: 'all', label: `すべて ${candidates.length}` },
                  { key: 'generated', label: `AI で作成 ${generatedCount}` },
                  { key: 'imported', label: `取り込み ${importedCount}` },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSourceFilter(option.key)}
                  aria-pressed={sourceFilter === option.key}
                  className={cx(
                    'nv-focus-ring rounded-[var(--nv-radius-sm)] px-2 py-1 text-xs font-semibold transition-colors',
                    sourceFilter === option.key
                      ? 'bg-[var(--nv-color-accent)] text-white'
                      : 'text-[var(--nv-color-muted)] hover:bg-[var(--nv-color-canvas)]'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-[var(--nv-radius-sm)] border border-dashed border-[var(--nv-color-border)] bg-[var(--nv-color-canvas)] px-3 py-8 text-center text-sm text-[var(--nv-color-muted)]">
            候補の画像はまだありません。「画像を作る」を押すと、ここに追加されます。
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-4">
            {filtered.map((image) => (
              <ImageCard
                key={image.id}
                image={image}
                isSelected={usedIds.has(image.id)}
                badge={usedIds.has(image.id) ? '使用中' : undefined}
                onSelect={() => onChange(placeImage(panelImages, slot, image.id))}
                selectLabel="使う"
                selectTone="primary"
                selectDisabled={disabled}
                onPreview={() => setPreviewImageId(image.id)}
                onDelete={onDeleteImage && !disabled ? () => onDeleteImage(image.id) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <ImagePreviewModal
        image={previewImageId ? (getImageById(previewImageId) ?? null) : null}
        open={previewImageId != null}
        onClose={() => setPreviewImageId(null)}
      />
    </div>
  );
}
