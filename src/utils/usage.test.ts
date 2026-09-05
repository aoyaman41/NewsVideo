import { describe, expect, it } from 'vitest';
import { usageRecordSchema } from '../schemas';
import { createOpenAIUsageRecord } from './usage';

describe('createOpenAIUsageRecord', () => {
  it('preserves GPT-5.6 cache, reasoning, and request-count details', () => {
    const record = createOpenAIUsageRecord('script_generate', {
      provider: 'openai',
      model: 'gpt-5.6-terra',
      inputTokens: 12_345,
      outputTokens: 678,
      cachedInputTokens: 4_000,
      cacheWriteTokens: 2_000,
      reasoningTokens: 321,
      requestCount: 1,
    });

    expect(record).toMatchObject({
      provider: 'openai',
      category: 'text',
      model: 'gpt-5.6-terra',
      operation: 'script_generate',
      inputTokens: 12_345,
      outputTokens: 678,
      cachedInputTokens: 4_000,
      cacheWriteTokens: 2_000,
      reasoningTokens: 321,
      requestCount: 1,
    });
    expect(() => usageRecordSchema.parse(record)).not.toThrow();
  });

  it('records aggregated request counts and clamps invalid token values', () => {
    const record = createOpenAIUsageRecord('image_prompt_generate', {
      provider: 'openai',
      model: 'gpt-5.6-luna',
      inputTokens: -10,
      outputTokens: Number.NaN,
      requestCount: 8,
    });

    expect(record).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      requestCount: 8,
    });
  });
});
