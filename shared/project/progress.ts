import type { Project } from './schema';
import { isVideoCurrent, partFreshness } from './integrity';

export function getProjectProgress(project: Project) {
  const states = project.parts.map((part) => partFreshness(project, part));
  const partCount = states.length;
  const missingPrompts = states.filter(
    (state) => state.prompt !== 'current' && state.image !== 'current'
  ).length;
  const missingImages = states.filter((state) => state.image !== 'current').length;
  const missingAudio = states.filter((state) => state.audio !== 'current').length;
  const hasArticle = Boolean(project.article.title.trim() && project.article.bodyText.trim());
  const hasScript = partCount > 0 && states.every((state) => state.script === 'current');
  const hasImage = hasScript && missingImages === 0;
  const hasAudio = hasScript && missingAudio === 0;
  const hasVideoOutput = isVideoCurrent(project);
  const stage: 'article' | 'script' | 'image' | 'audio' | 'video' = !hasArticle
    ? 'article'
    : !hasScript
      ? 'script'
      : !hasImage
        ? 'image'
        : !hasAudio
          ? 'audio'
          : 'video';
  return {
    stage,
    completedSteps: [hasArticle, hasScript, hasImage, hasAudio, hasVideoOutput].filter(Boolean)
      .length,
    totalSteps: 5 as const,
    partCount,
    missingPrompts,
    missingImages,
    missingAudio,
    hasVideoOutput,
  };
}
