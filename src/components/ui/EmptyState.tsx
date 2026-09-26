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
      {icon && <div className="text-[var(--nv-color-muted)]">{icon}</div>}
      <h4 className="text-sm font-semibold text-[var(--nv-color-text)]">{title}</h4>
      {description && (
        <p className="max-w-[42ch] text-xs text-[var(--nv-color-muted)]">{description}</p>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
