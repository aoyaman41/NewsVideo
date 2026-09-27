import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '../schemas';
import { DEFAULT_COST_RATES, estimateUsageCostUsd, type CostRates } from './cost';

// M3: 既定のテキストモデルを Claude にしても、過去の OpenAI レコードの料金は変えない。
// OpenAI のキャッシュ書き込みは、どの計算経路でも割増の単価で計上する
function record(overrides: Partial<UsageRecord>): UsageRecord {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    provider: 'openai',
    category: 'text',
    model: 'gpt-5.2',
    operation: 'test',
    createdAt: '2026-09-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('OpenAI text cost defaults', () => {
  it('keeps pricing OpenAI records without a model at the legacy GPT-5.2 rate', () => {
    expect(DEFAULT_COST_RATES.openai.defaultModel).toBe('gpt-5.2');
    const withoutModel = estimateUsageCostUsd(
      record({ model: '', inputTokens: 100_000, outputTokens: 10_000 }),
      DEFAULT_COST_RATES
    );
    const gpt52 = estimateUsageCostUsd(
      record({ model: 'gpt-5.2', inputTokens: 100_000, outputTokens: 10_000 }),
      DEFAULT_COST_RATES
    );

    expect(withoutModel).toBeCloseTo(gpt52, 10);
    expect(withoutModel).toBeCloseTo(0.315, 10);
  });
});

describe('OpenAI cache writes on the token-only path', () => {
  it('prices cache writes with the write rate when no modality breakdown is recorded', () => {
    const rates: CostRates = {
      ...DEFAULT_COST_RATES,
      openai: {
        ...DEFAULT_COST_RATES.openai,
        imageRatesByModel: {
          'test-image-model': {
            inputPer1MTokensUsd: 4,
            cachedInputPer1MTokensUsd: 0.4,
            cacheWritePer1MTokensUsd: 5,
            outputPer1MTokensUsd: 20,
          },
        },
      },
    };

    const cost = estimateUsageCostUsd(
      record({
        category: 'image',
        model: 'test-image-model',
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        cacheWriteTokens: 300_000,
        outputTokens: 0,
      }),
      rates
    );

    // 未キャッシュ 50 万 × $4 + 読み取り 20 万 × $0.4 + 書き込み 30 万 × $5
    expect(cost).toBeCloseTo(2 + 0.08 + 1.5, 10);
  });
});
