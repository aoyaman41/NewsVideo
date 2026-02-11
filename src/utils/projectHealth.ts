import type { Project } from '../schemas';
import type { ProjectProgressSummary, Tone, WorkflowStage } from '../types/ui';

function hasText(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function buildLatestPromptByPartId(
  project: Project
): Map<string, { partId: string; createdAt: string }> {
  const map = new Map<string, { partId: string; createdAt: string }>();
  const activePartIds = new Set(project.parts.map((part) => part.id));

  for (const prompt of project.prompts ?? []) {
    if (!activePartIds.has(prompt.partId)) continue;
    const current = map.get(prompt.partId);
    if (!current || prompt.createdAt >= current.createdAt) {
      map.set(prompt.partId, { partId: prompt.partId, createdAt: prompt.createdAt });
    }
  }

  return map;
}

export function summarizeProjectProgress(project: Project): ProjectProgressSummary {
  const parts = project.parts ?? [];
  const partCount = parts.length;
  const latestPromptByPartId = buildLatestPromptByPartId(project);

  const missingPrompts = parts.reduce((count, part) => {
    return latestPromptByPartId.has(part.id) ? count : count + 1;
  }, 0);

  const missingImages = parts.reduce((count, part) => {
    return (part.panelImages?.length ?? 0) > 0 ? count : count + 1;
  }, 0);

  const missingAudio = parts.reduce((count, part) => {
    return part.audio ? count : count + 1;
  }, 0);

  const hasArticle = hasText(project.article?.title) && hasText(project.article?.bodyText);
  const hasScript = partCount > 0;
  const hasImage = hasScript && missingImages === 0 && missingPrompts === 0;
  const hasAudio = hasScript && missingAudio === 0;
  const hasVideoOutput = Boolean(project.autoGenerationStatus?.lastVideoPath);

  let stage: WorkflowStage = 'video';
  if (!hasArticle) {
    stage = 'article';
  } else if (!hasScript) {
    stage = 'script';
  } else if (!hasImage) {
    stage = 'image';
  } else if (!hasAudio) {
    stage = 'audio';
  }

  const completedSteps = [hasArticle, hasScript, hasImage, hasAudio, hasVideoOutput].filter(
    Boolean
  ).length;

  return {
    stage,
    completedSteps,
    totalSteps: 5,
    partCount,
    missingPrompts,
    missingImages,
    missingAudio,
    hasVideoOutput,
  };
}

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
