import { expect, it } from 'vitest';
import { createImageUsageRecordFromAssets, createOpenAIUsageRecord } from './usage';
import { DEFAULT_COST_RATES, estimateUsageCostUsd } from './cost';
import type { ImageAsset } from '../schemas';

it('bills GPT Image 2 as OpenAI image generation instead of Gemini or text generation', () => {
  const image: ImageAsset = {
    id: crypto.randomUUID(),
    filePath: '/tmp/test.png',
    sourceType: 'generated',
    metadata: {
      width: 2560,
      height: 1440,
      mimeType: 'image/png',
      fileSize: 42,
      createdAt: new Date().toISOString(),
      tags: [],
      generation: {
        model: 'gpt-image-2',
        resolution: '2k',
        imageSizeTier: '2K',
        aspectRatio: '16:9',
        inputTokens: 1000,
        outputTokens: 2000,
      },
    },
  };
  const record = createImageUsageRecordFromAssets([image], 'image_generate');
  expect(record).toMatchObject({ provider: 'openai', model: 'gpt-image-2', category: 'image' });
  expect(estimateUsageCostUsd(record!, DEFAULT_COST_RATES)).toBeCloseTo(0.065);
});

it('uses Astra prices and cache discount', () => {
  const record = createOpenAIUsageRecord('script_generate', {
    model: 'gpt-6-astra',
    inputTokens: 10000,
    cachedInputTokens: 5000,
    outputTokens: 1000,
    requestCount: 1,
  });
  expect(estimateUsageCostUsd(record!, DEFAULT_COST_RATES)).toBeCloseTo(0.105);
});
