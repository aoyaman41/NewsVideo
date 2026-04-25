import type { ImageAsset, UsageRecord } from '../schemas';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_IMAGE_MODEL,
  GEMINI_TEXT_COMPLETION_MODEL,
  OPENAI_TEXT_COMPLETION_MODEL,
  getImageModelProvider,
  isImageModel,
  type ImageResolution,
  type ImageSizeTier,
} from '../../shared/constants/models';

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: 'openai' | 'gemini';
};

type ImageAspectRatio = '16:9' | '1:1' | '9:16';

type ImageUsageDetails = {
  provider: 'openai' | 'gemini';
  imageCount: number;
  operation: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  imageResolution?: ImageResolution;
  imageSizeTier?: ImageSizeTier;
  imageAspectRatio?: ImageAspectRatio;
};

function clampNonNegative(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value ?? 0));
}

export function createOpenAIUsageRecord(
  operation: string,
  usage?: TokenUsage | null
): UsageRecord | null {
  if (!usage) return null;
  const provider = usage.provider === 'gemini' ? 'gemini' : 'openai';
  const defaultModel =
    provider === 'gemini' ? GEMINI_TEXT_COMPLETION_MODEL : OPENAI_TEXT_COMPLETION_MODEL;
  return {
    id: crypto.randomUUID(),
    provider,
    category: 'text',
    model: usage.model || defaultModel,
    operation,
    inputTokens: clampNonNegative(usage.inputTokens),
    outputTokens: clampNonNegative(usage.outputTokens),
    cachedInputTokens: clampNonNegative(usage.cachedInputTokens),
    createdAt: new Date().toISOString(),
  };
}

export function createGeminiTtsUsageRecord(
  operation: string,
  usage?: TokenUsage | null
): UsageRecord | null {
  if (!usage) return null;
  return {
    id: crypto.randomUUID(),
    provider: 'gemini',
    category: 'tts',
    model: usage.model || DEFAULT_GEMINI_TTS_MODEL,
    operation,
    inputTokens: clampNonNegative(usage.inputTokens),
    outputTokens: clampNonNegative(usage.outputTokens),
    createdAt: new Date().toISOString(),
  };
}

export function createImageUsageRecord(details: ImageUsageDetails): UsageRecord | null {
  const count = clampNonNegative(details.imageCount);
  if (count <= 0) return null;
  return {
    id: crypto.randomUUID(),
    provider: details.provider,
    category: 'image',
    model: details.model || (details.provider === 'openai' ? 'gpt-image-2' : DEFAULT_IMAGE_MODEL),
    operation: details.operation,
    inputTokens: clampNonNegative(details.inputTokens),
    outputTokens: clampNonNegative(details.outputTokens),
    imageCount: count,
    imageResolution: details.imageResolution,
    imageSizeTier: details.imageSizeTier,
    imageAspectRatio: details.imageAspectRatio,
    createdAt: new Date().toISOString(),
  };
}

export function createImageUsageRecordFromAssets(
  images: ImageAsset[],
  operation: string
): UsageRecord | null {
  const generated = images
    .map((image) => image.metadata.generation)
    .filter((metadata): metadata is NonNullable<ImageAsset['metadata']['generation']> => !!metadata);

  if (generated.length === 0) return null;

  const first = generated[0];
  const sameModel = generated.every((metadata) => metadata.model === first.model);
  const sameResolution = generated.every((metadata) => metadata.resolution === first.resolution);
  const sameSizeTier = generated.every((metadata) => metadata.imageSizeTier === first.imageSizeTier);
  const sameAspectRatio = generated.every((metadata) => metadata.aspectRatio === first.aspectRatio);
  const provider = isImageModel(first.model) ? getImageModelProvider(first.model) : 'gemini';

  return createImageUsageRecord({
    provider,
    imageCount: images.length,
    operation,
    model: sameModel ? first.model : undefined,
    inputTokens: generated.reduce((sum, metadata) => sum + (metadata.inputTokens ?? 0), 0),
    outputTokens: generated.reduce((sum, metadata) => sum + (metadata.outputTokens ?? 0), 0),
    imageResolution: sameResolution ? first.resolution : undefined,
    imageSizeTier: sameSizeTier ? first.imageSizeTier : undefined,
    imageAspectRatio: sameAspectRatio ? first.aspectRatio : undefined,
  });
}

export const createGeminiImageUsageRecordFromAssets = createImageUsageRecordFromAssets;
