import type { ReactNode } from 'react';
import { cx } from '../../utils/cx';

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'nv-surface-muted flex flex-col items-center justify-center gap-2 px-5 py-10 text-center',
        className
      )}
    >
      {icon && <div className="text-slate-400">{icon}</div>}
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      {description && <p className="max-w-[42ch] text-xs text-slate-500">{description}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
