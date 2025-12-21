import type { UsageRecord } from '../schemas';

export type CostRates = {
  currency: 'USD';
  openai: {
    model: string;
    inputPer1MTokensUsd: number;
    outputPer1MTokensUsd: number;
  };
  gemini: {
    ttsModel: string;
    ttsInputPer1MTokensUsd: number;
    ttsOutputPer1MTokensUsd: number;
    imageModel: string;
    imageInputPerImageUsd: number;
    imageOutputPerImageUsd: number;
  };
};

export const DEFAULT_COST_RATES: CostRates = {
  currency: 'USD',
  openai: {
    model: 'gpt-5.2',
    inputPer1MTokensUsd: 1.75,
    outputPer1MTokensUsd: 14.0,
  },
  gemini: {
    ttsModel: 'gemini-2.5-pro-preview-tts',
    ttsInputPer1MTokensUsd: 1.0,
    ttsOutputPer1MTokensUsd: 20.0,
    imageModel: 'gemini-3-pro-image-preview',
    imageInputPerImageUsd: 0.0011,
    imageOutputPerImageUsd: 0.134,
  },
};

export function estimateUsageCostUsd(record: UsageRecord, rates: CostRates): number {
  if (record.provider === 'openai') {
    const input = (record.inputTokens ?? 0) * rates.openai.inputPer1MTokensUsd / 1_000_000;
    const output = (record.outputTokens ?? 0) * rates.openai.outputPer1MTokensUsd / 1_000_000;
    return input + output;
  }

  if (record.provider === 'gemini') {
    if (record.category === 'tts') {
      const input = (record.inputTokens ?? 0) * rates.gemini.ttsInputPer1MTokensUsd / 1_000_000;
      const output = (record.outputTokens ?? 0) * rates.gemini.ttsOutputPer1MTokensUsd / 1_000_000;
      return input + output;
    }

    if (record.category === 'image') {
      const count = record.imageCount ?? 0;
      return count * (rates.gemini.imageInputPerImageUsd + rates.gemini.imageOutputPerImageUsd);
    }
  }

  return 0;
}

export function sumUsageCostUsd(records: UsageRecord[], rates: CostRates): number {
  return records.reduce((sum, record) => sum + estimateUsageCostUsd(record, rates), 0);
}

export function formatUsd(amount: number): string {
  const abs = Math.abs(amount);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `$${amount.toFixed(digits)}`;
}
