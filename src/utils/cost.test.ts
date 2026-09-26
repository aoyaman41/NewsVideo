import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '../schemas';
import { DEFAULT_COST_RATES, estimateUsageCostUsd, normalizeCostRates } from './cost';

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
  it.each([
    [
      'gpt-5.6-sol',
      {
        inputPer1MTokensUsd: 5,
        cachedInputPer1MTokensUsd: 0.5,
        cacheWritePer1MTokensUsd: 6.25,
        outputPer1MTokensUsd: 30,
      },
    ],
    [
      'gpt-5.6-terra',
      {
        inputPer1MTokensUsd: 2.5,
        cachedInputPer1MTokensUsd: 0.25,
        cacheWritePer1MTokensUsd: 3.125,
        outputPer1MTokensUsd: 15,
      },
    ],
    [
      'gpt-5.6-luna',
      {
        inputPer1MTokensUsd: 1,
        cachedInputPer1MTokensUsd: 0.1,
        cacheWritePer1MTokensUsd: 1.25,
        outputPer1MTokensUsd: 6,
      },
    ],
  ])('defines GPT-5.6 pricing and long-context metadata for %s', (model, expected) => {
    expect(DEFAULT_COST_RATES.openai.textRatesByModel[model]).toMatchObject({
      ...expected,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
    });
  });

  it.each([
    ['gpt-5.6-sol', 0.8],
    ['gpt-5.6-terra', 0.4],
    ['gpt-5.6-luna', 0.16],
  ])('uses the standard GPT-5.6 rate for %s', (model, expected) => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({ model, inputTokens: 100_000, outputTokens: 10_000 }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(expected, 10);
  });

  it.each([
    ['gpt-5.6', 'gpt-5.6-sol'],
    ['gpt-5.6-2026-07-09', 'gpt-5.6-sol'],
    ['gpt-5.6-sol-2026-07-09', 'gpt-5.6-sol'],
    ['gpt-5.6-terra-2026-07-09', 'gpt-5.6-terra'],
    ['gpt-5.6-luna-2026-07-09', 'gpt-5.6-luna'],
  ])('resolves %s to the same rate as %s', (model, canonicalModel) => {
    const usage = { inputTokens: 100_000, outputTokens: 10_000 };
    const resolvedCost = estimateUsageCostUsd(
      buildUsageRecord({ model, ...usage }),
      DEFAULT_COST_RATES
    );
    const canonicalCost = estimateUsageCostUsd(
      buildUsageRecord({ model: canonicalModel, ...usage }),
      DEFAULT_COST_RATES
    );

    expect(resolvedCost).toBeCloseTo(canonicalCost, 10);
  });

  it('does not treat an unknown GPT-5.6 suffix as Sol', () => {
    const rates = {
      ...DEFAULT_COST_RATES,
      openai: {
        ...DEFAULT_COST_RATES.openai,
        defaultModel: 'gpt-5.2',
      },
    };
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model: 'gpt-5.6-mars',
        inputTokens: 100_000,
        outputTokens: 10_000,
      }),
      rates
    );

    expect(cost).toBeCloseTo(0.315, 10);
    expect(cost).not.toBeCloseTo(0.8, 10);
  });

  it('keeps standard rates at exactly 272,000 input tokens', () => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model: 'gpt-5.6-sol',
        inputTokens: 272_000,
        outputTokens: 10_000,
        requestCount: 1,
      }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(1.66, 10);
  });

  it('applies whole-request multipliers above 272,000 input tokens', () => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model: 'gpt-5.6-sol',
        inputTokens: 272_001,
        outputTokens: 10_000,
        requestCount: 1,
      }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(3.17001, 10);
  });

  it('applies the documented GPT-5.4 long-context multipliers', () => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model: 'gpt-5.4',
        inputTokens: 272_001,
        outputTokens: 10_000,
        requestCount: 1,
      }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(1.585005, 10);
  });

  it('does not infer long-context pricing from aggregated usage', () => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model: 'gpt-5.6-sol',
        inputTokens: 300_000,
        outputTokens: 10_000,
        requestCount: 2,
      }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(1.8, 10);
  });

  it.each([
    ['gpt-5.6-sol', 0.006575],
    ['gpt-5.6-terra', 0.0032875],
    ['gpt-5.6-luna', 0.001315],
  ])('prices GPT-5.6 cache writes separately for %s', (model, expected) => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model,
        inputTokens: 1_000,
        cachedInputTokens: 400,
        cacheWriteTokens: 300,
        outputTokens: 100,
        requestCount: 1,
      }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(expected, 10);
  });

  it('clamps cached reads and cache writes within total input tokens', () => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model: 'gpt-5.6-luna',
        inputTokens: 1_000,
        cachedInputTokens: 800,
        cacheWriteTokens: 800,
        outputTokens: 0,
      }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(0.00033, 10);
  });

  it('falls back to the regular input rate for cache writes on older models', () => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model: 'gpt-5.4',
        inputTokens: 1_000,
        cachedInputTokens: 200,
        cacheWriteTokens: 300,
        outputTokens: 0,
      }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(0.00205, 10);
  });

  it('applies long-context input multipliers to all GPT-5.6 input buckets', () => {
    const cost = estimateUsageCostUsd(
      buildUsageRecord({
        model: 'gpt-5.6-terra',
        inputTokens: 300_000,
        cachedInputTokens: 100_000,
        cacheWriteTokens: 50_000,
        outputTokens: 10_000,
        requestCount: 1,
      }),
      DEFAULT_COST_RATES
    );

    expect(cost).toBeCloseTo(1.3375, 10);
  });

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
  it('preserves GPT-5.6 cache-write and long-context metadata for partial overrides', () => {
    const normalized = normalizeCostRates({
      openai: {
        textRatesByModel: {
          'gpt-5.6-sol': {
            inputPer1MTokensUsd: 7,
            outputPer1MTokensUsd: 35,
          },
        },
      },
    });

    expect(normalized.openai.textRatesByModel['gpt-5.6-sol']).toMatchObject({
      inputPer1MTokensUsd: 7,
      outputPer1MTokensUsd: 35,
      cachedInputPer1MTokensUsd: 0.5,
      cacheWritePer1MTokensUsd: 6.25,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
    });
  });

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

describe('Gemini TTS cost', () => {
  const ttsRecord = (model: string) =>
    buildUsageRecord({
      provider: 'gemini',
      category: 'tts',
      model,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

  it.each([
    ['gemini-3.8-flash-tts', 0.5, 9],
    ['gemini-3.8-flash-lite-tts', 0.5, 6],
  ])('prices %s at the rate through 2026-12-31', (model, input, output) => {
    expect(DEFAULT_COST_RATES.gemini.ttsRatesByModel[model]).toEqual({
      inputPer1MTokensUsd: input,
      outputPer1MTokensUsd: output,
    });
    expect(estimateUsageCostUsd(ttsRecord(model), normalizeCostRates(undefined))).toBeCloseTo(
      input + output,
      10
    );
  });

  it('keeps pricing records without a known model at the previous default TTS rate', () => {
    const rates = normalizeCostRates({});
    expect(rates.gemini.ttsModel).toBe('gemini-3.1-flash-tts-preview');
    for (const model of ['', 'gemini-unknown-tts']) {
      expect(estimateUsageCostUsd(ttsRecord(model), rates)).toBeCloseTo(1 + 20, 10);
    }
    expect(estimateUsageCostUsd(ttsRecord('gemini-3.1-flash-tts-preview'), rates)).toBeCloseTo(
      21,
      10
    );
  });

  it('applies legacy flat TTS rates to the previous default model, not the new default', () => {
    const rates = normalizeCostRates({
      gemini: { ttsInputPer1MTokensUsd: 2, ttsOutputPer1MTokensUsd: 30 },
    });
    expect(rates.gemini.ttsRatesByModel['gemini-3.1-flash-tts-preview']).toEqual({
      inputPer1MTokensUsd: 2,
      outputPer1MTokensUsd: 30,
    });
    expect(rates.gemini.ttsRatesByModel['gemini-3.8-flash-tts']).toEqual({
      inputPer1MTokensUsd: 0.5,
      outputPer1MTokensUsd: 9,
    });
  });

  it('adds the 3.8 rates to saved cost settings that predate them', () => {
    const rates = normalizeCostRates({
      gemini: {
        ttsModel: 'gemini-3.1-flash-tts-preview',
        ttsRatesByModel: {
          'gemini-3.1-flash-tts-preview': { inputPer1MTokensUsd: 1, outputPer1MTokensUsd: 20 },
        },
      },
    });
    expect(rates.gemini.ttsRatesByModel['gemini-3.8-flash-lite-tts']).toEqual({
      inputPer1MTokensUsd: 0.5,
      outputPer1MTokensUsd: 6,
    });
  });
});

describe('GPT Image 2.5 cost', () => {
  const imageRecord = (model: string) =>
    buildUsageRecord({
      provider: 'openai',
      category: 'image',
      model,
      inputTokens: 1_560,
      textInputTokens: 1_000,
      imageInputTokens: 560,
      outputTokens: 1_120,
      imageCount: 1,
      imageSizeTier: '1K',
    });

  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])(
    'prices %s at the same token rates as GPT Image 2',
    (model) => {
      expect(DEFAULT_COST_RATES.openai.imageRatesByModel[model]).toEqual({
        inputPer1MTokensUsd: 5,
        cachedInputPer1MTokensUsd: 1.25,
        imageInputPer1MTokensUsd: 8,
        imageCachedInputPer1MTokensUsd: 2,
        outputPer1MTokensUsd: 30,
      });
      expect(DEFAULT_COST_RATES.openai.imageRatesByModel[model]).toEqual(
        DEFAULT_COST_RATES.openai.imageRatesByModel['gpt-image-2']
      );
      const cost = estimateUsageCostUsd(imageRecord(model), DEFAULT_COST_RATES);
      expect(cost).toBeCloseTo(0.04308, 10);
      expect(cost).toBeCloseTo(
        estimateUsageCostUsd(imageRecord('gpt-image-2'), DEFAULT_COST_RATES),
        10
      );
    }
  );

  it('keeps GPT Image 2 as the fallback for OpenAI image records without a model', () => {
    expect(DEFAULT_COST_RATES.openai.imageModel).toBe('gpt-image-2');
  });

  it('adds the 2.5 rates to saved cost settings that predate them', () => {
    const rates = normalizeCostRates({
      openai: {
        imageModel: 'gpt-image-2',
        imageRatesByModel: {
          'gpt-image-2': {
            inputPer1MTokensUsd: 5,
            cachedInputPer1MTokensUsd: 1.25,
            imageInputPer1MTokensUsd: 8,
            imageCachedInputPer1MTokensUsd: 2,
            outputPer1MTokensUsd: 30,
          },
        },
      },
    });
    for (const model of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
      expect(rates.openai.imageRatesByModel[model]).toMatchObject({
        inputPer1MTokensUsd: 5,
        outputPer1MTokensUsd: 30,
      });
      expect(estimateUsageCostUsd(imageRecord(model), rates)).toBeCloseTo(0.04308, 10);
    }
  });
});
