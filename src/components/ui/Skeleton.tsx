import { cx } from '../../utils/cx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-[8px] bg-slate-200', className)} />;
}
