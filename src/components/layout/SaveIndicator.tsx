import { useLocation } from 'react-router-dom';
import { projectClient, useProjectSaveStatus } from '../../stores/projectStore';
import { cleanErrorMessage } from '../errors/explainError';
import { Button } from '../ui';
import { projectIdFromPath } from './workflowLabels';

function formatTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

/**
 * プロジェクトの保存状態(自動保存)。画面上部のヘッダーの右端 1 か所にだけ出す。
 * 問題がないときは控えめな文字だけにし、失敗や競合のときだけ操作ボタンを出す。
 */
export function SaveIndicator() {
  const location = useLocation();
  const id = projectIdFromPath(location.pathname) ?? undefined;
  const state = useProjectSaveStatus(id);
  if (!id || !state.project) return null;

  const hasConflict = state.conflicts.length > 0;
  const text = hasConflict
    ? '別の画面の変更と重なりました'
    : state.error
      ? '保存できませんでした'
      : state.saving
        ? '保存中…'
        : state.dirty
          ? '保存待ち'
          : `保存済み${state.lastSavedAt ? ` ${formatTime(state.lastSavedAt)}` : ''}`;
  const problem = hasConflict || Boolean(state.error);

  return (
    <div
      className="titlebar-no-drag flex shrink-0 items-center gap-2 text-xs"
      role="status"
      aria-live="polite"
    >
      <span
        className={
          problem ? 'font-semibold text-[var(--nv-color-danger)]' : 'text-[var(--nv-color-muted)]'
        }
        title={state.error ? cleanErrorMessage(state.error) : undefined}
      >
        {text}
      </span>
      {hasConflict ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void projectClient.resolveConflicts(id).catch(() => {})}
          >
            この画面の内容で保存
          </Button>
          <Button size="sm" variant="ghost" onClick={() => projectClient.useSaved(id)}>
            保存済みの内容に戻す
          </Button>
        </>
      ) : (
        state.error && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void projectClient.flush(id).catch(() => {})}
          >
            もう一度保存
          </Button>
        )
      )}
    </div>
  );
}
