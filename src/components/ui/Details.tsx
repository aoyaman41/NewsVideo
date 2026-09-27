import type { ReactNode } from 'react';
import { cx } from '../../utils/cx';

/** 折りたたみ。上級者向けの項目や補足をまとめるときに使う */
export function Details({
  summary,
  children,
  defaultOpen = false,
  onToggle,
  className,
  bodyClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** 開閉したとき(開いたときだけ重い中身を描く、などに使う) */
  onToggle?: (open: boolean) => void;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <details
      className={cx('nv-details', className)}
      open={defaultOpen || undefined}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
    >
      <summary>{summary}</summary>
      <div className={cx('nv-details-body', bodyClassName)}>{children}</div>
    </details>
  );
}
