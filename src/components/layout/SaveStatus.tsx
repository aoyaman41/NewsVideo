import { useLocation } from 'react-router-dom';
import { projectClient, useProjectSaveStatus } from '../../stores/projectStore';

export function SaveStatus() {
  const location = useLocation();
  const id = location.pathname.match(/\/projects\/([^/]+)/)?.[1];
  const state = useProjectSaveStatus(id);
  if (!state.project) return null;
  return (
    <div
      className="titlebar-no-drag flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-2 text-xs"
      role="status"
      aria-live="polite"
    >
      <span>
        {state.error
          ? `未保存：${state.error}`
          : state.saving
            ? '保存中…'
            : state.dirty
              ? '未保存の変更があります'
              : `保存済み ${state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleTimeString() : ''}`}
      </span>
      {(state.dirty || state.error) && (
        <button
          className="rounded border px-2 py-1 font-semibold"
          onClick={() => {
            if (id)
              void (
                state.conflicts.length
                  ? projectClient.resolveConflicts(id)
                  : projectClient.flush(id)
              ).catch(() => {});
          }}
        >
          {state.conflicts.length ? '競合箇所でこの編集を使って保存' : '保存を再試行'}
        </button>
      )}
      {state.conflicts.length > 0 && (
        <button
          onClick={() => {
            if (id) projectClient.useSaved(id);
          }}
        >
          保存済みの内容へ戻す
        </button>
      )}
    </div>
  );
}
