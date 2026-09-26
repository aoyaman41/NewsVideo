import { describe, expect, it } from 'vitest';
import type { ImageAsset, UsageRecord } from '../schemas';
import { DEFAULT_COST_RATES, estimateUsageCostUsd, normalizeCostRates } from './cost';
import { createImageUsageRecord, createImageUsageRecordFromAssets } from './usage';
import { estimateGenerationUsd } from '../../shared/project/generationEstimate';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';

function imageRecord(overrides: Partial<UsageRecord>): UsageRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    provider: 'gemini',
    category: 'image',
    model: 'gemini-3.1-flash-image',
    operation: 'test',
    createdAt: '2026-09-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('Gemini image GA pricing', () => {
  it.each([
    ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview'],
    ['gemini-3-pro-image', 'gemini-3-pro-image-preview'],
  ])('prices %s the same as the retired %s', (current, legacy) => {
    expect(DEFAULT_COST_RATES.gemini.imageRatesByModel[current]).toEqual(
      DEFAULT_COST_RATES.gemini.imageRatesByModel[legacy]
    );
  });

  it('keeps the token-based Flash price for GA and preview records', () => {
    for (const model of ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview']) {
      const cost = estimateUsageCostUsd(
        imageRecord({
          model,
          inputTokens: 3_000,
          outputTokens: 2_580,
          imageCount: 2,
          imageSizeTier: '1K',
        }),
        DEFAULT_COST_RATES
      );
      expect(cost).toBeCloseTo(0.1563, 10);
    }
  });

  it('keeps the per-image Pro price for GA and preview records', () => {
    for (const model of ['gemini-3-pro-image', 'gemini-3-pro-image-preview']) {
      const cost = estimateUsageCostUsd(
        imageRecord({ model, inputTokens: 4_000, imageCount: 2, imageSizeTier: '4K' }),
        DEFAULT_COST_RATES
      );
      expect(cost).toBeCloseTo(0.488, 10);
    }
  });

  it('prices records without a known model as the legacy Flash preview, not the new default', () => {
    expect(DEFAULT_COST_RATES.gemini.imageModel).toBe('gemini-3.1-flash-image-preview');
    const unknown = estimateUsageCostUsd(
      imageRecord({ model: 'unknown-image-model', imageCount: 1, imageSizeTier: '2K' }),
      DEFAULT_COST_RATES
    );
    const legacy = estimateUsageCostUsd(
      imageRecord({
        model: 'gemini-3.1-flash-image-preview',
        imageCount: 1,
        imageSizeTier: '2K',
      }),
      DEFAULT_COST_RATES
    );
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBeCloseTo(legacy, 10);
  });

  it('adds the GA rows to saved cost settings that predate them', () => {
    const rates = normalizeCostRates({
      gemini: {
        imageModel: 'gemini-3.1-flash-image-preview',
        imageRatesByModel: {
          'gemini-3.1-flash-image-preview': { billingMode: 'per_image' },
        },
      },
    });
    expect(rates.gemini.imageRatesByModel['gemini-3.1-flash-image']).toMatchObject({
      billingMode: 'per_token',
      outputPer1MTokensUsd: 60,
    });
    expect(rates.gemini.imageRatesByModel['gemini-3-pro-image']).toMatchObject({
      billingMode: 'per_image',
    });
  });

  it('estimates a planning allowance for the new OpenAI default and the GA Gemini models', () => {
    for (const imageModel of [
      DEFAULT_SETTINGS.imageModel,
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
    ] as const) {
      const usd = estimateGenerationUsd('image', 'prompt', { ...DEFAULT_SETTINGS, imageModel });
      expect(Number.isFinite(usd)).toBe(true);
      expect(usd).toBeGreaterThan(0);
    }
  });
});

describe('Gemini image usage records', () => {
  it('records legacy Gemini image usage without a model as the preview Flash model', () => {
    expect(
      createImageUsageRecord({ provider: 'gemini', imageCount: 1, operation: 'image_generate' })
        ?.model
    ).toBe('gemini-3.1-flash-image-preview');
  });

  it('keeps the model id recorded on existing image metadata unchanged', () => {
    const image = (model: string): ImageAsset => ({
      id: crypto.randomUUID(),
      filePath: '/tmp/image.png',
      sourceType: 'generated',
      metadata: {
        width: 1920,
        height: 1080,
        mimeType: 'image/png',
        fileSize: 1,
        createdAt: '2026-03-29T00:00:00.000Z',
        tags: [],
        generation: {
          model,
          resolution: 'fhd',
          imageSizeTier: '1K',
          aspectRatio: '16:9',
          inputTokens: 10,
          outputTokens: 1290,
        },
      },
    });
    expect(
      createImageUsageRecordFromAssets([image('gemini-3-pro-image-preview')], 'image_generate')
    ).toMatchObject({ provider: 'gemini', model: 'gemini-3-pro-image-preview' });
    expect(
      createImageUsageRecordFromAssets([image('gemini-3.1-flash-image')], 'image_generate')
    ).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-image' });
  });
});
