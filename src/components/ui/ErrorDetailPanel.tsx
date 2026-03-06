import { cx } from '../../utils/cx';
import { StatusChip } from './StatusChip';

export function ErrorDetailPanel({
  message,
  title = '直近の問題',
  onDismiss,
  className,
}: {
  message: string;
  title?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'rounded-[12px] border border-[var(--nv-color-border)] bg-slate-50 px-4 py-3',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StatusChip tone="danger" label={title} />
          <p className="mt-2 text-sm text-slate-700">{message}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-[8px] px-2 py-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
            aria-label="詳細を閉じる"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
