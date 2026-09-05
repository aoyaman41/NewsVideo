import type { AppSettings } from '../settings/appSettings';
import type { UsageRecord, Project } from './schema';
import { partFreshness } from './integrity';
import { estimateUsageCostUsd, normalizeCostRates } from '../../src/utils/cost';

export type GenerationOperation = 'script' | 'prompt' | 'image' | 'audio';

/** Planning allowance, not a quote: token counts are estimated before the provider responds. */
export function estimateGenerationUsd(
  kind: GenerationOperation,
  text: string,
  settings: AppSettings,
  count = 1
): number {
  if (kind === 'audio' && settings.ttsEngine === 'macos_tts') return 0;
  const model =
    kind === 'script'
      ? settings.scriptTextModel
      : kind === 'prompt'
        ? settings.imagePromptTextModel
        : kind === 'image'
          ? settings.imageModel
          : settings.ttsModel;
  const provider = model.startsWith('gpt') ? 'openai' : 'gemini';
  const record: UsageRecord = {
    id: 'estimate',
    createdAt: '',
    provider,
    model,
    operation: kind,
    category: kind === 'image' ? 'image' : kind === 'audio' ? 'tts' : 'text',
    inputTokens: Math.ceil(text.length / 1.5) + 1500,
    outputTokens:
      kind === 'image'
        ? settings.imageResolution === '4k'
          ? 32000
          : settings.imageResolution === '2k'
            ? 16000
            : 8000
        : kind === 'audio'
          ? Math.ceil((text.length / 4) * 25)
          : 3000 * count,
    imageCount: kind === 'image' ? count : undefined,
    imageResolution: settings.imageResolution,
    imageSizeTier:
      settings.imageResolution === '4k' ? '4K' : settings.imageResolution === '2k' ? '2K' : '1K',
  };
  return estimateUsageCostUsd(record, normalizeCostRates(settings.cost));
}

export function estimateProjectGeneration(
  project: Project,
  settings: AppSettings,
  targetPartCount: number
) {
  const candidate = { ...project, generationConfig: { ...settings } };
  const needsScript =
    !project.parts.length ||
    project.parts.some((part) => partFreshness(candidate, part).script !== 'current');
  const sceneCount = needsScript ? targetPartCount : project.parts.length;
  const text = needsScript
    ? '文'.repeat(project.presentationProfile.targetDurationPerPartSec * 4)
    : project.parts.map((part) => part.scriptText).join('');
  const count = (kind: 'prompt' | 'image' | 'audio') =>
    needsScript
      ? sceneCount
      : project.parts.filter(
          (part) =>
            partFreshness(candidate, part)[kind] !== 'current' &&
            (kind !== 'prompt' || partFreshness(candidate, part).image !== 'current')
        ).length;
  const steps = [
    {
      kind: 'script',
      label: '台本',
      count: needsScript ? 1 : 0,
      usd: needsScript
        ? estimateGenerationUsd('script', project.article.bodyText, settings, sceneCount)
        : 0,
    },
    ...(['prompt', 'image', 'audio'] as const).map((kind) => ({
      kind,
      label: kind === 'prompt' ? '画像プロンプト' : kind === 'image' ? '画像' : '音声',
      count: count(kind),
      usd:
        count(kind) *
        estimateGenerationUsd(
          kind,
          text.slice(0, Math.max(120, Math.ceil(text.length / sceneCount))),
          settings
        ),
    })),
  ];
  const usd = steps.reduce((sum, step) => sum + step.usd, 0);
  return { steps, lowerUsd: usd * 0.5, upperUsd: usd * 2 };
}
