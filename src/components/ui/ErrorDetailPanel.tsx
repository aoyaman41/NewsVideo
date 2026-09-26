import type { ReactNode } from 'react';
import { cx } from '../../utils/cx';

export function ErrorDetailPanel({
  message,
  title = '直近の問題',
  details,
  actions,
  onDismiss,
  className,
}: {
  message: string;
  title?: string;
  /** 例外の原文など。折りたたみの中に表示する */
  details?: string;
  /** 次の操作(「設定を開く」など) */
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cx(
        'rounded-[var(--nv-radius-md)] border border-[var(--nv-color-danger)]/30 bg-[var(--nv-color-danger)]/5 px-4 py-3',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--nv-color-danger)]">{title}</p>
          <p className="mt-1 text-sm text-[var(--nv-color-text)]">{message}</p>
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
          {details && details !== message && (
            <details className="nv-details mt-3">
              <summary>詳しい内容</summary>
              <p className="nv-details-body whitespace-pre-wrap break-all font-mono text-xs text-[var(--nv-color-muted)]">
                {details}
              </p>
            </details>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="nv-focus-ring shrink-0 rounded-[var(--nv-radius-sm)] px-2 py-1 text-[var(--nv-color-muted)] transition-colors hover:bg-white"
            aria-label="閉じる"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
