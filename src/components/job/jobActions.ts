import type { GenerationJob } from '../../../shared/project/jobs';
import { projectClient } from '../../stores/projectStore';

/** 画面側の未保存の編集を書き込んでから、止まっているジョブを続きから再開する */
export async function resumeJob(
  projectId: string,
  job: Pick<GenerationJob, 'mode' | 'targetPartCount' | 'budgetUsd'>,
  overrides: { budgetUsd?: number | null } = {}
): Promise<void> {
  // 保存に失敗したときは、古い内容で生成しないよう再開をやめてエラーを伝える
  await projectClient.flush(projectId);
  await window.electronAPI.jobs.start(projectId, {
    mode: job.mode,
    targetPartCount: job.targetPartCount,
    // null は「上限を外して続ける」
    budgetUsd:
      overrides.budgetUsd === null
        ? undefined
        : (overrides.budgetUsd ?? job.budgetUsd ?? undefined),
  });
}

export async function cancelJob(projectId: string): Promise<void> {
  await window.electronAPI.jobs.cancel(projectId);
}
