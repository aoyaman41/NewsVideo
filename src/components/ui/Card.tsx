import type { ReactNode } from 'react';
import { cx } from '../../utils/cx';

interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 画面の主役になるカード。見出しを一段大きくする */
  emphasis?: boolean;
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  emphasis = false,
}: CardProps) {
  return (
    <section className={cx('nv-surface overflow-hidden', className)}>
      {(title || subtitle || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--nv-color-border)] px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h3
                className={cx(
                  'truncate font-semibold text-[var(--nv-color-text)]',
                  emphasis ? 'text-base' : 'text-sm'
                )}
              >
                {title}
              </h3>
            )}
            {subtitle && <p className="mt-0.5 text-sm text-[var(--nv-color-muted)]">{subtitle}</p>}
          </div>
          {actions && <div className="titlebar-no-drag shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
