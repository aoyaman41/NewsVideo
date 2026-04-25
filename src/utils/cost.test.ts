import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '../schemas';
import {
  DEFAULT_COST_RATES,
  estimateUsageCostUsd,
  normalizeCostRates,
} from './cost';

function buildUsageRecord(overrides: Partial<UsageRecord>): UsageRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    provider: 'openai',
    category: 'text',
    model: 'gpt-5.2',
    operation: 'test',
    createdAt: '2026-03-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('estimateUsageCostUsd', () => {
  it('charges cached and uncached OpenAI input tokens separately', () => {
    const record = buildUsageRecord({
      provider: 'openai',
      category: 'text',
      model: 'gpt-5.4',
      inputTokens: 1000,
      cachedInputTokens: 800,
      outputTokens: 500,
    });

    const cost = estimateUsageCostUsd(record, DEFAULT_COST_RATES);

    expect(cost).toBeCloseTo(0.0082, 10);
  });

  it('prices GPT-5.5 text generations with default OpenAI rates', () => {
    const record = buildUsageRecord({
      provider: 'openai',
      category: 'text',
      model: 'gpt-5.5',
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 200,
    });

    const cost = estimateUsageCostUsd(record, DEFAULT_COST_RATES);

    expect(cost).toBeCloseTo(0.00875, 10);
  });

  it('prices Gemini text generations instead of returning zero', () => {
    const record = buildUsageRecord({
      provider: 'gemini',
      category: 'text',
      model: 'gemini-3.1-pro-preview',
      inputTokens: 10_000,
      outputTokens: 2_000,
    });

    const cost = estimateUsageCostUsd(record, DEFAULT_COST_RATES);

    expect(cost).toBeCloseTo(0.044, 10);
  });

  it('uses Gemini long-context rates above the threshold', () => {
    const record = buildUsageRecord({
      provider: 'gemini',
      category: 'text',
      model: 'gemini-3.1-pro-preview',
      inputTokens: 250_000,
      outputTokens: 4_000,
    });

    const cost = estimateUsageCostUsd(record, DEFAULT_COST_RATES);

    expect(cost).toBeCloseTo(1.072, 10);
  });

  it('uses per-image Gemini Pro image pricing by size tier', () => {
    const record = buildUsageRecord({
      provider: 'gemini',
      category: 'image',
      model: 'gemini-3-pro-image-preview',
      inputTokens: 4_000,
      outputTokens: 999_999,
      imageCount: 2,
      imageSizeTier: '4K',
    });

    const cost = estimateUsageCostUsd(record, DEFAULT_COST_RATES);

    expect(cost).toBeCloseTo(0.488, 10);
  });

  it('uses token-based Gemini Flash image pricing when output tokens are available', () => {
    const record = buildUsageRecord({
      provider: 'gemini',
      category: 'image',
      model: 'gemini-3.1-flash-image-preview',
      inputTokens: 3_000,
      outputTokens: 2_580,
      imageCount: 2,
      imageSizeTier: '1K',
    });

    const cost = estimateUsageCostUsd(record, DEFAULT_COST_RATES);

    expect(cost).toBeCloseTo(0.1563, 10);
  });

  it('prices OpenAI image generations with GPT Image 2 token rates', () => {
    const record = buildUsageRecord({
      provider: 'openai',
      category: 'image',
      model: 'gpt-image-2',
      inputTokens: 2_000,
      outputTokens: 1_290,
      imageCount: 1,
      imageSizeTier: '1K',
    });

    const cost = estimateUsageCostUsd(record, DEFAULT_COST_RATES);

    expect(cost).toBeCloseTo(0.0487, 10);
  });

  it('prices OpenAI image input tokens separately when reference images are used', () => {
    const record = buildUsageRecord({
      provider: 'openai',
      category: 'image',
      model: 'gpt-image-2',
      inputTokens: 1_560,
      textInputTokens: 1_000,
      imageInputTokens: 560,
      outputTokens: 1_120,
      imageCount: 1,
      imageSizeTier: '1K',
    });

    const cost = estimateUsageCostUsd(record, DEFAULT_COST_RATES);

    expect(cost).toBeCloseTo(0.04308, 10);
  });
});

describe('normalizeCostRates', () => {
  it('keeps legacy settings compatible with the new structure', () => {
    const normalized = normalizeCostRates({
      openai: {
        model: 'gpt-5.2',
        inputPer1MTokensUsd: 2,
        outputPer1MTokensUsd: 10,
        cachedInputPer1MTokensUsd: 0.2,
      },
      gemini: {
        ttsModel: 'gemini-2.5-flash-preview-tts',
        ttsInputPer1MTokensUsd: 1.5,
        ttsOutputPer1MTokensUsd: 25,
        imageModel: 'gemini-3-pro-image-preview',
        imageInputPerImageUsd: 0.01,
        imageOutputPerImageUsd: 0.5,
      },
    });

    expect(normalized.openai.textRatesByModel['gpt-5.2']).toMatchObject({
      inputPer1MTokensUsd: 2,
      outputPer1MTokensUsd: 10,
      cachedInputPer1MTokensUsd: 0.2,
    });
    expect(normalized.gemini.ttsRatesByModel['gemini-2.5-flash-preview-tts']).toMatchObject({
      inputPer1MTokensUsd: 1.5,
      outputPer1MTokensUsd: 25,
    });
    expect(DEFAULT_COST_RATES.gemini.ttsModel).toBe('gemini-3.1-flash-tts-preview');
    expect(DEFAULT_COST_RATES.gemini.ttsRatesByModel['gemini-3.1-flash-tts-preview']).toMatchObject(
      {
        inputPer1MTokensUsd: 1,
        outputPer1MTokensUsd: 20,
      }
    );

    const legacyImageCost = estimateUsageCostUsd(
      buildUsageRecord({
        provider: 'gemini',
        category: 'image',
        model: 'gemini-3-pro-image-preview',
        imageCount: 1,
        imageResolution: '2k',
      }),
      normalized
    );

    expect(legacyImageCost).toBeCloseTo(0.51, 10);
  });
});
