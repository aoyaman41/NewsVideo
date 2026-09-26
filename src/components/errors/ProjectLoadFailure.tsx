import { Button, EmptyState } from '../ui';
import { FriendlyError } from './FriendlyError';

/** 作業画面でプロジェクトを開けなかったときの表示。原因が分かっていれば FriendlyError で示す */
export function ProjectLoadFailure({ error, onBack }: { error: unknown; onBack: () => void }) {
  const back = <Button onClick={onBack}>プロジェクト一覧に戻る</Button>;
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      {error !== null && error !== undefined ? (
        <div className="w-full max-w-lg space-y-3">
          <FriendlyError error={error} title="プロジェクトを読み込めません" />
          {back}
        </div>
      ) : (
        <EmptyState
          title="プロジェクトを読み込めません"
          description="プロジェクトが見つかりません"
          action={back}
        />
      )}
    </div>
  );
}
