import { cx } from '../../utils/cx';

export function ProgressBar({
  value,
  max = 100,
  label,
  className,
  tone = 'accent',
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
  tone?: 'accent' | 'success' | 'warning';
}) {
  const ratio = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const toneClass =
    tone === 'success'
      ? 'bg-[var(--nv-color-success)]'
      : tone === 'warning'
        ? 'bg-[var(--nv-color-warning)]'
        : 'bg-[var(--nv-color-accent)]';

  return (
    <div className={cx('space-y-1', className)}>
      {label && <div className="text-xs font-medium text-[var(--nv-color-muted)]">{label}</div>}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio)}
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--nv-color-border)]/70"
      >
        <div
          className={cx(
            'h-full transition-[width] duration-[var(--nv-duration-base)] ease-linear',
            toneClass
          )}
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}
