import type { ImageAsset } from '../../schemas';
import { toLocalFileUrl } from '../../utils/toLocalFileUrl';
import { cx } from '../../utils/cx';
import { Button } from '../ui';

interface ImageCardProps {
  image: ImageAsset;
  /** 選択中(使用中)として強調する */
  isSelected?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
  onPreview?: () => void;
  selectLabel?: string;
  selectTone?: 'primary' | 'ghost';
  /** 画像の上に出す短いラベル(「使用中」など) */
  badge?: string;
  selectDisabled?: boolean;
}

const FALLBACK_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"%3E%3Crect fill="%23f2f4f7" width="160" height="90"/%3E%3Ctext fill="%23475569" font-family="sans-serif" font-size="11" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3E%E7%94%BB%E5%83%8F%E3%81%8C%E3%81%82%E3%82%8A%E3%81%BE%E3%81%9B%E3%82%93%3C/text%3E%3C/svg%3E';

export function ImageCard({
  image,
  isSelected = false,
  onSelect,
  onDelete,
  onPreview,
  selectLabel,
  selectTone = 'ghost',
  badge,
  selectDisabled = false,
}: ImageCardProps) {
  const sourceLabel = image.sourceType === 'generated' ? 'AI で作成' : '取り込み画像';

  return (
    <div
      className={cx(
        'group relative overflow-hidden rounded-[var(--nv-radius-sm)] border bg-white transition-colors',
        isSelected
          ? 'border-[var(--nv-color-accent)] ring-2 ring-[var(--nv-color-accent)]/25'
          : 'border-[var(--nv-color-border)] hover:border-[var(--nv-color-muted)]/40'
      )}
    >
      <button
        type="button"
        onClick={onPreview ?? onSelect}
        disabled={!onPreview && !onSelect}
        className="nv-focus-ring block aspect-video w-full cursor-zoom-in bg-[var(--nv-color-canvas)] disabled:cursor-default"
        aria-label={onPreview ? `${sourceLabel}を拡大して見る` : sourceLabel}
      >
        <img
          src={toLocalFileUrl(image.filePath)}
          alt=""
          className="h-full w-full object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
          }}
        />
      </button>

      {badge && (
        <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-[var(--nv-color-accent)] px-2 py-0.5 text-xs font-semibold text-white">
          {badge}
        </span>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="nv-focus-ring absolute right-2 top-2 rounded-full bg-[var(--nv-color-danger)] p-1.5 text-white opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-90 group-focus-within:opacity-90"
          aria-label="この画像を削除"
          title="この画像を削除"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-[var(--nv-color-border)] px-2 py-1.5">
        <span className="truncate text-xs text-[var(--nv-color-muted)]">{sourceLabel}</span>
        {onSelect && (
          <Button
            size="sm"
            variant={selectTone === 'primary' ? 'primary' : 'secondary'}
            onClick={onSelect}
            disabled={selectDisabled}
          >
            {selectLabel || '選ぶ'}
          </Button>
        )}
      </div>
    </div>
  );
}
