import { describe, expect, it } from 'vitest';
import { usageRecordSchema, type UsageRecord } from '../schemas';
import { DEFAULT_COST_RATES, estimateUsageCostUsd, normalizeCostRates } from './cost';
import { createOpenAIUsageRecord } from './usage';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';
import { estimateGenerationUsd } from '../../shared/project/generationEstimate';

function claudeRecord(overrides: Partial<UsageRecord>): UsageRecord {
  return {
    id: '00000000-0000-4000-8000-000000000055',
    provider: 'anthropic',
    category: 'text',
    model: 'claude-opus-5-5',
    operation: 'script_generate',
    createdAt: '2026-09-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('Claude Opus 5.5 pricing', () => {
  it('defines the Opus 5.5 token rates including cache reads and 5-minute cache writes', () => {
    expect(DEFAULT_COST_RATES.anthropic).toEqual({
      defaultTextModel: 'claude-opus-5-5',
      textRatesByModel: {
        'claude-opus-5-5': {
          inputPer1MTokensUsd: 4,
          cachedInputPer1MTokensUsd: 0.2,
          cacheWritePer1MTokensUsd: 5,
          outputPer1MTokensUsd: 20,
        },
      },
    });
  });

  it('charges uncached input and output at the standard rate', () => {
    const cost = estimateUsageCostUsd(
      claudeRecord({ inputTokens: 10_000, outputTokens: 1_000 }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(0.06, 10);
  });

  it('charges cache reads and cache writes separately from the input total', () => {
    const cost = estimateUsageCostUsd(
      claudeRecord({
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        cacheWriteTokens: 100_000,
        outputTokens: 100_000,
      }),
      DEFAULT_COST_RATES
    );

    // 700K * $4 + 200K * $0.20 + 100K * $5 + 100K * $20
    expect(cost).toBeCloseTo(2.8 + 0.04 + 0.5 + 2.0, 10);
  });

  it('falls back to the Opus 5.5 rate for an unregistered Claude model id', () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000 };
    expect(
      estimateUsageCostUsd(
        claudeRecord({ model: 'claude-opus-5-5-snapshot', ...usage }),
        DEFAULT_COST_RATES
      )
    ).toBeCloseTo(estimateUsageCostUsd(claudeRecord(usage), DEFAULT_COST_RATES), 10);
  });

  it('merges user-edited Anthropic rates and keeps defaults for missing sections', () => {
    const edited = normalizeCostRates({
      anthropic: {
        textRatesByModel: {
          'claude-opus-5-5': { inputPer1MTokensUsd: 8, outputPer1MTokensUsd: 40 },
          'bad-model': { inputPer1MTokensUsd: -1, outputPer1MTokensUsd: 1 },
        },
      },
    });

    expect(edited.anthropic.textRatesByModel['claude-opus-5-5']).toEqual({
      inputPer1MTokensUsd: 8,
      cachedInputPer1MTokensUsd: 0.2,
      cacheWritePer1MTokensUsd: 5,
      outputPer1MTokensUsd: 40,
    });
    expect(edited.anthropic.textRatesByModel).not.toHaveProperty('bad-model');
    expect(normalizeCostRates({ openai: {} }).anthropic).toEqual(DEFAULT_COST_RATES.anthropic);
  });
});

describe('Claude usage records', () => {
  it('keeps the anthropic provider and cache details so the cost is not zero', () => {
    const record = createOpenAIUsageRecord('script_generate', {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      inputTokens: 3_500,
      cachedInputTokens: 2_000,
      cacheWriteTokens: 500,
      outputTokens: 700,
      reasoningTokens: 300,
      requestCount: 1,
    });

    expect(record).toMatchObject({
      provider: 'anthropic',
      category: 'text',
      model: 'claude-opus-5-5',
      inputTokens: 3_500,
      cachedInputTokens: 2_000,
      cacheWriteTokens: 500,
      outputTokens: 700,
    });
    expect(() => usageRecordSchema.parse(record)).not.toThrow();
    expect(estimateUsageCostUsd(record!, DEFAULT_COST_RATES)).toBeGreaterThan(0);
  });

  it('uses Opus 5.5 as the model fallback for anthropic usage without a model', () => {
    const record = createOpenAIUsageRecord('image_prompt_generate', {
      provider: 'anthropic',
      inputTokens: 100,
      outputTokens: 10,
    });

    expect(record).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
  });
});

describe('Claude generation estimates', () => {
  it('estimates Claude script generation with the Anthropic rate', () => {
    const settings = { ...DEFAULT_SETTINGS, scriptTextModel: 'claude-opus-5-5' as const };
    const text = '文'.repeat(300);
    const inputTokens = Math.ceil(text.length / 1.5) + 1500;
    const outputTokens = 3000 * 2;

    expect(estimateGenerationUsd('script', text, settings, 2)).toBeCloseTo(
      (inputTokens * 4 + outputTokens * 20) / 1_000_000,
      10
    );
  });
});
