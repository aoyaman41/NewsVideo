import type { UsageRecord } from '../schemas';

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: 'openai' | 'gemini';
};

const DEFAULT_OPENAI_MODEL = 'gpt-5.2';
const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.1-pro';
const DEFAULT_GEMINI_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

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
  const defaultModel = provider === 'gemini' ? DEFAULT_GEMINI_TEXT_MODEL : DEFAULT_OPENAI_MODEL;
  return {
    id: crypto.randomUUID(),
    provider,
    category: 'text',
    model: usage.model || defaultModel,
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
  operation: string = 'image_generate',
  model: string = DEFAULT_GEMINI_IMAGE_MODEL
): UsageRecord | null {
  const count = clampNonNegative(imageCount);
  if (count <= 0) return null;
  return {
    id: crypto.randomUUID(),
    provider: 'gemini',
    category: 'image',
    model: model || DEFAULT_GEMINI_IMAGE_MODEL,
    operation,
    imageCount: count,
    createdAt: new Date().toISOString(),
  };
}
