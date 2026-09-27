import { useMemo } from 'react';
import { Button, ErrorDetailPanel } from '../ui';
import { useOpenSettings, type SettingsSection } from '../settings/settingsNavigation';
import { explainError, type ErrorAction, type ErrorExplanation } from './explainError';

type FriendlyErrorProps = {
  /** 例外、またはエラー文。explanation を渡すときは省略できる */
  error?: unknown;
  /** 自動生成ジョブの分類(job.error.kind) */
  kind?: string;
  /** 説明を作り済みのとき(まとめて作る処理の一部失敗など)に渡す */
  explanation?: ErrorExplanation;
  /** 何に失敗したか(例:「画像を作れませんでした」)。省略すると原因を見出しにする */
  title?: string;
  /** 「もう一度試す」を押したとき。渡さなければボタンを出さない */
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  className?: string;
  /** 枠を付けずに中身だけを出す(進捗表示の中などで使う) */
  bare?: boolean;
};

const SETTINGS_ACTIONS: Record<
  Exclude<ErrorAction, 'retry'>,
  { label: string; section: SettingsSection }
> = {
  openApiKeys: { label: 'API キーを設定する', section: 'api' },
  chooseOtherModel: { label: '別のモデルを選ぶ', section: 'models' },
  openVideoSettings: { label: '動画の設定を開く', section: 'video' },
};

/**
 * エラー表示の共通部品。既知のエラーは原因と次の操作をボタン付きで示し、元のエラー文は
 * 折りたたみ(「詳しい内容」)で見せる。全画面でこれを使う。
 */
export function FriendlyError({
  error,
  kind,
  explanation: given,
  title,
  onRetry,
  retryLabel = 'もう一度試す',
  onDismiss,
  className,
  bare = false,
}: FriendlyErrorProps) {
  const explanation: ErrorExplanation = useMemo(
    () => given ?? explainError(error, { kind }),
    [error, given, kind]
  );
  const openSettings = useOpenSettings();

  const actions = explanation.actions.filter((action) => action !== 'retry' || Boolean(onRetry));
  // 「処理に失敗しました」は見出し(何に失敗したか)と重なるので、見出しがあるときは出さない
  const cause = title && explanation.kind !== 'unknown' ? explanation.title : null;

  return (
    <ErrorDetailPanel
      bare={bare}
      className={className}
      title={title ?? explanation.title}
      message={
        <>
          {cause && <p className="font-semibold">{cause}</p>}
          <p className={cause ? 'mt-0.5 text-[var(--nv-color-muted)]' : undefined}>
            {explanation.description}
          </p>
        </>
      }
      details={
        explanation.detail && explanation.detail !== explanation.description
          ? explanation.detail
          : undefined
      }
      onDismiss={onDismiss}
      actions={
        actions.length > 0
          ? actions.map((action, index) =>
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
                  onClick={() => openSettings(SETTINGS_ACTIONS[action].section)}
                >
                  {SETTINGS_ACTIONS[action].label}
                </Button>
              )
            )
          : undefined
      }
    />
  );
}
