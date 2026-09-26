import { useMemo } from 'react';
import { Button } from '../ui';
import { cx } from '../../utils/cx';
import { useOpenSettings } from '../settings/settingsNavigation';
import { explainError, type ErrorAction, type ErrorExplanation } from './explainError';

type FriendlyErrorProps = {
  error: unknown;
  /** 自動生成ジョブの分類(job.error.kind) */
  kind?: string;
  /** 「もう一度試す」を押したとき。渡さなければボタンを出さない */
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  /** 見出しを差し替える(例:「自動生成が途中で止まりました」) */
  title?: string;
  className?: string;
  /** 枠を付けずに中身だけを出す(進捗表示の中などで使う) */
  bare?: boolean;
};

const ACTION_LABELS: Record<Exclude<ErrorAction, 'retry'>, string> = {
  openApiKeys: 'API キーを設定する',
  chooseOtherModel: '別のモデルを選ぶ',
};

/** 既知のエラーは原因と次の操作をボタン付きで示し、元のエラー文は折りたたみで見せる */
export function FriendlyError({
  error,
  kind,
  onRetry,
  retryLabel = 'もう一度試す',
  onDismiss,
  title,
  className,
  bare = false,
}: FriendlyErrorProps) {
  const explanation: ErrorExplanation = useMemo(() => explainError(error, { kind }), [error, kind]);
  const openSettings = useOpenSettings();

  const actions = explanation.actions.filter((action) => action !== 'retry' || Boolean(onRetry));

  const body = (
    <div className="min-w-0 flex-1 space-y-2">
      {title && <p className="text-sm font-semibold text-[var(--nv-color-text)]">{title}</p>}
      <p className="text-sm font-semibold text-[var(--nv-color-danger)]">{explanation.title}</p>
      <p className="text-sm text-[var(--nv-color-muted)]">{explanation.description}</p>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {actions.map((action, index) =>
            action === 'retry' ? (
              <Button
                key={action}
                size="sm"
                variant={index === 0 ? 'primary' : 'secondary'}
                onClick={onRetry}
              >
                {retryLabel}
              </Button>
            ) : (
              <Button
                key={action}
                size="sm"
                variant={index === 0 ? 'primary' : 'secondary'}
                onClick={() => openSettings(action === 'openApiKeys' ? 'api' : 'models')}
              >
                {ACTION_LABELS[action]}
              </Button>
            )
          )}
        </div>
      )}
      {explanation.detail && explanation.detail !== explanation.title && (
        <details className="text-xs text-[var(--nv-color-muted)]">
          <summary className="nv-focus-ring w-fit cursor-pointer rounded-[var(--nv-radius-sm)]">
            詳しい内容
          </summary>
          <p className="mt-1 break-all whitespace-pre-wrap">{explanation.detail}</p>
        </details>
      )}
    </div>
  );

  if (bare) return body;

  return (
    <div
      role="alert"
      className={cx(
        'nv-surface flex items-start gap-3 border-l-4 border-l-[var(--nv-color-danger)] px-4 py-3',
        className
      )}
    >
      {body}
      {onDismiss && (
        <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="エラーの表示を閉じる">
          閉じる
        </Button>
      )}
    </div>
  );
}
