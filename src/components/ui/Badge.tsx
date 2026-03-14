import type { ReactNode } from 'react';
import { cx } from '../../utils/cx';

type BadgeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const toneClasses: Record<BadgeTone, string> = {
  info: 'bg-blue-100 text-blue-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  neutral: 'bg-slate-200 text-slate-700',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
