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
      ? 'bg-emerald-600'
      : tone === 'warning'
        ? 'bg-amber-600'
        : 'bg-[var(--nv-color-accent)]';

  return (
    <div className={cx('space-y-1', className)}>
      {label && <div className="text-xs font-medium text-slate-600">{label}</div>}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
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
