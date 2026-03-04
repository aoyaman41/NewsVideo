import type { UsageRecord } from '../schemas';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_IMAGE_MODEL,
  GEMINI_TEXT_COMPLETION_MODEL,
  OPENAI_TEXT_COMPLETION_MODEL,
} from '../../shared/constants/models';

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: 'openai' | 'gemini';
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
  model: string = DEFAULT_IMAGE_MODEL
): UsageRecord | null {
  const count = clampNonNegative(imageCount);
  if (count <= 0) return null;
  return {
    id: crypto.randomUUID(),
    provider: 'gemini',
    category: 'image',
    model: model || DEFAULT_IMAGE_MODEL,
    operation,
    imageCount: count,
    createdAt: new Date().toISOString(),
  };
}
