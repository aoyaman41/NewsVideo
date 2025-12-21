import type { UsageRecord } from '../schemas';

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
};

const DEFAULT_OPENAI_MODEL = 'gpt-5.2';
const DEFAULT_GEMINI_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3-pro-image-preview';

function clampNonNegative(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value ?? 0));
}

export function createOpenAIUsageRecord(
  operation: string,
  usage?: TokenUsage | null
): UsageRecord | null {
  if (!usage) return null;
  return {
    id: crypto.randomUUID(),
    provider: 'openai',
    category: 'text',
    model: usage.model || DEFAULT_OPENAI_MODEL,
    operation,
    inputTokens: clampNonNegative(usage.inputTokens),
    outputTokens: clampNonNegative(usage.outputTokens),
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

export function createGeminiImageUsageRecord(
  imageCount: number,
  operation: string = 'image_generate'
): UsageRecord | null {
  const count = clampNonNegative(imageCount);
  if (count <= 0) return null;
  return {
    id: crypto.randomUUID(),
    provider: 'gemini',
    category: 'image',
    model: DEFAULT_GEMINI_IMAGE_MODEL,
    operation,
    imageCount: count,
    createdAt: new Date().toISOString(),
  };
}
