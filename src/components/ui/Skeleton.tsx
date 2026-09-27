import { cx } from '../../utils/cx';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        'animate-pulse rounded-[var(--nv-radius-sm)] bg-[var(--nv-color-border)]/70',
        className
      )}
    />
  );
}
