import type { ProjectProgressSummary, WorkflowStage } from '../../types/ui';

/** 画面上の工程名(用語は「記事」「台本」「画像」「音声」「動画」に統一する) */
export const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string> = {
  article: '記事',
  script: '台本',
  image: '画像',
  audio: '音声',
  video: '動画',
};

export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  'article',
  'script',
  'image',
  'audio',
  'video',
];

/** 次にやることの短い案内 */
export function nextStepHint(summary: Pick<ProjectProgressSummary, 'stage' | 'hasVideoOutput'>) {
  if (summary.hasVideoOutput) return '動画ができています';
  switch (summary.stage) {
    case 'article':
      return '次は記事を貼り付けます';
    case 'script':
      return '次は台本を作ります';
    case 'image':
      return '次は画像をそろえます';
    case 'audio':
      return '次は音声をそろえます';
    case 'video':
    default:
      return '次は動画を書き出します';
  }
}

/** URL からプロジェクト ID を取り出す(/projects/:id/...) */
export function projectIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
}
