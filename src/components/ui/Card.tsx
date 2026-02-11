import type { ReactNode } from 'react';
import { cx } from '../../utils/cx';

interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Card({ title, subtitle, actions, children, className, bodyClassName }: CardProps) {
  return (
    <section className={cx('nv-surface overflow-hidden', className)}>
      {(title || subtitle || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nv-color-border)] px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="titlebar-no-drag shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
