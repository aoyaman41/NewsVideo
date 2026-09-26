import { useNavigate } from 'react-router-dom';
import { Button, ErrorDetailPanel } from '../ui';
import type { FriendlyError } from './friendlyError';

/** 作業画面の上部に出すエラー表示。原因と次の操作をボタン付きで示す */
export function ErrorNotice({
  error,
  onDismiss,
  returnTo,
  className,
}: {
  error: FriendlyError | null;
  onDismiss: () => void;
  /** 設定画面から戻る先 */
  returnTo: string;
  className?: string;
}) {
  const navigate = useNavigate();
  if (!error) return null;
  return (
    <ErrorDetailPanel
      className={className}
      title={error.title}
      message={error.message}
      details={error.details}
      onDismiss={onDismiss}
      actions={
        error.action === 'openSettings' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate('/settings', { state: { returnTo } })}
          >
            設定を開く
          </Button>
        ) : undefined
      }
    />
  );
}
