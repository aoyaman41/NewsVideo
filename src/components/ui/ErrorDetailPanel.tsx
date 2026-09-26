import type { ReactNode } from 'react';
import { cx } from '../../utils/cx';
import { Details } from './Details';

/**
 * エラーの表示枠(見た目だけ)。例外を言い換えて出すときは、これを使う FriendlyError
 * (src/components/errors/FriendlyError.tsx)を使う。
 */
export function ErrorDetailPanel({
  message,
  title = '直近の問題',
  details,
  actions,
  onDismiss,
  className,
  bare = false,
}: {
  message: ReactNode;
  title?: string;
  /** 例外の原文など。折りたたみの中に表示する */
  details?: string;
  /** 次の操作(「設定を開く」など) */
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  /** 枠を付けずに中身だけを出す(自動生成の進捗表示の中などで使う) */
  bare?: boolean;
}) {
  const body = (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-[var(--nv-color-danger)]">{title}</p>
      <div className="mt-1 text-sm text-[var(--nv-color-text)]">{message}</div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      {details && details !== message && (
        <Details summary="詳しい内容" className="mt-3">
          <p className="whitespace-pre-wrap break-all font-mono text-xs text-[var(--nv-color-muted)]">
            {details}
          </p>
        </Details>
      )}
    </div>
  );

  if (bare) return body;

  return (
    <div
      role="alert"
      className={cx(
        'rounded-[var(--nv-radius-md)] border border-[var(--nv-color-danger)]/30 bg-[var(--nv-color-danger)]/5 px-4 py-3',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {body}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="nv-focus-ring shrink-0 rounded-[var(--nv-radius-sm)] px-2 py-1 text-[var(--nv-color-muted)] transition-colors hover:bg-[var(--nv-color-surface)]"
            aria-label="閉じる"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
