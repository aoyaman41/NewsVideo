import { useEffect, useState } from 'react';
import type { Project } from '../../schemas';

export const JOB_ACTIVE_MESSAGE = '自動生成の実行中です。終わるまでお待ちください。';

/**
 * このプロジェクトの自動生成が実行中(または順番待ち)かどうか。
 * 保持データに未保存の編集があっても状態を追えるよう、ジョブのイベントも直接購読する。
 */
export function useJobActive(projectId: string | undefined, project: Project | null): boolean {
  const [liveJob, setLiveJob] = useState<{ projectId: string; status?: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    return window.electronAPI.events.subscribe('job:statusChange', (payload: unknown) => {
      const event = payload as { projectId?: string; job?: { status?: string } } | null;
      if (event?.projectId === projectId) setLiveJob({ projectId, status: event.job?.status });
    });
  }, [projectId]);

  const status =
    (liveJob && liveJob.projectId === projectId ? liveJob.status : undefined) ??
    project?.job?.status;
  return status === 'running' || status === 'queued';
}
