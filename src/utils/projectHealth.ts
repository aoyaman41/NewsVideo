import type { ProjectProgressSummary, Tone, WorkflowStage } from '../types/ui';

export { getProjectProgress as summarizeProjectProgress } from '../../shared/project/progress';

export function stageLabel(stage: WorkflowStage): string {
  switch (stage) {
    case 'article':
      return '記事';
    case 'script':
      return 'スクリプト';
    case 'image':
      return '画像';
    case 'audio':
      return '音声';
    case 'video':
      return '動画';
    default:
      return '記事';
  }
}

export function stagePath(projectId: string, stage: WorkflowStage): string {
  return `/projects/${projectId}/${stage}`;
}

export function summaryTone(summary: ProjectProgressSummary): Tone {
  if (summary.hasVideoOutput) return 'success';
  if (summary.missingAudio > 0 || summary.missingImages > 0) return 'warning';
  if (summary.completedSteps <= 1) return 'info';
  return 'neutral';
}

export function nextActionLabel(summary: ProjectProgressSummary): string {
  switch (summary.stage) {
    case 'article':
      return '記事を入力';
    case 'script':
      return 'スクリプト生成';
    case 'image':
      return '画像を揃える';
    case 'audio':
      return '音声を揃える';
    case 'video':
      return summary.hasVideoOutput ? '動画を確認' : '動画を書き出し';
    default:
      return '作業を進める';
  }
}
