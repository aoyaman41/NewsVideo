import { useCallback, useRef } from 'react';
import type { Project } from '../../schemas';
import { projectClient } from '../../stores/projectStore';

/**
 * 生成結果などを、その時点の最新のプロジェクトに当てて保存する。
 * 待ち時間の長い処理の間に画面で編集されても上書きしないよう、変更は 1 件ずつ順に適用する。
 */
export function useProjectCommit(projectId: string | undefined) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(
    (mutate: (latest: Project) => Project): Promise<Project> => {
      const run = queue.current.then(async () => {
        if (!projectId) throw new Error('プロジェクトが見つかりません。');
        const latest = await projectClient.load(projectId);
        const next = mutate(latest);
        if (next !== latest) await projectClient.save(next);
        return next;
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [projectId]
  );
}
