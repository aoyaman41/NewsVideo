import type { UsageRecord } from '../schemas';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_SCRIPT_TEXT_MODEL,
  IMAGE_MODELS,
} from '../../shared/constants/models';

type ImageCostRate = {
  inputPerImageUsd: number;
  outputPerImageUsd: number;
};

const KNOWN_GEMINI_IMAGE_MODELS = IMAGE_MODELS;
const DEFAULT_IMAGE_COST_RATE: ImageCostRate = {
  inputPerImageUsd: 0.0011,
  outputPerImageUsd: 0.134,
};

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
    imageRatesByModel: Record<string, ImageCostRate>;
    // 旧設定との互換用（単一レート）
    imageInputPerImageUsd?: number;
    imageOutputPerImageUsd?: number;
  };
};

export const DEFAULT_COST_RATES: CostRates = {
  currency: 'USD',
  openai: {
    model: DEFAULT_SCRIPT_TEXT_MODEL,
    inputPer1MTokensUsd: 1.75,
    outputPer1MTokensUsd: 14.0,
  },
  gemini: {
    ttsModel: 'gemini-2.5-pro-preview-tts',
    ttsInputPer1MTokensUsd: 1.0,
    ttsOutputPer1MTokensUsd: 20.0,
    imageModel: DEFAULT_IMAGE_MODEL,
    imageRatesByModel: {
      [IMAGE_MODELS[0]]: { ...DEFAULT_IMAGE_COST_RATE },
      [IMAGE_MODELS[1]]: { ...DEFAULT_IMAGE_COST_RATE },
    },
  },
};

function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function resolveImageCostRate(model: string | undefined, rates: CostRates): ImageCostRate {
  const byModel = rates.gemini.imageRatesByModel || {};
  if (model && byModel[model]) {
    return byModel[model];
  }

  const configuredDefault = rates.gemini.imageModel;
  if (configuredDefault && byModel[configuredDefault]) {
    return byModel[configuredDefault];
  }

  const legacyInput = toNonNegativeNumber(rates.gemini.imageInputPerImageUsd);
  const legacyOutput = toNonNegativeNumber(rates.gemini.imageOutputPerImageUsd);
  if (legacyInput !== null && legacyOutput !== null) {
    return { inputPerImageUsd: legacyInput, outputPerImageUsd: legacyOutput };
  }

  const firstRate = Object.values(byModel)[0];
  return firstRate ?? DEFAULT_IMAGE_COST_RATE;
}

export function normalizeCostRates(input?: unknown): CostRates {
  const base = DEFAULT_COST_RATES;
  if (!input || typeof input !== 'object') return base;

  const raw = input as {
    openai?: {
      model?: unknown;
      inputPer1MTokensUsd?: unknown;
      outputPer1MTokensUsd?: unknown;
    };
    gemini?: {
      ttsModel?: unknown;
      ttsInputPer1MTokensUsd?: unknown;
      ttsOutputPer1MTokensUsd?: unknown;
      imageModel?: unknown;
      imageRatesByModel?: unknown;
      imageInputPerImageUsd?: unknown;
      imageOutputPerImageUsd?: unknown;
    };
  };

  const openai = {
    model:
      typeof raw.openai?.model === 'string' && raw.openai.model.trim().length > 0
        ? raw.openai.model
        : base.openai.model,
    inputPer1MTokensUsd:
      toNonNegativeNumber(raw.openai?.inputPer1MTokensUsd) ?? base.openai.inputPer1MTokensUsd,
    outputPer1MTokensUsd:
      toNonNegativeNumber(raw.openai?.outputPer1MTokensUsd) ?? base.openai.outputPer1MTokensUsd,
  };

  const imageModel =
    typeof raw.gemini?.imageModel === 'string' && raw.gemini.imageModel.trim().length > 0
      ? raw.gemini.imageModel
      : base.gemini.imageModel;

  const imageRatesByModel: Record<string, ImageCostRate> = {
    ...base.gemini.imageRatesByModel,
  };

  const imageRatesRaw = raw.gemini?.imageRatesByModel;
  let hasMapOverride = false;
  if (imageRatesRaw && typeof imageRatesRaw === 'object') {
    for (const [model, rate] of Object.entries(imageRatesRaw as Record<string, unknown>)) {
      if (!rate || typeof rate !== 'object') continue;
      const rateRaw = rate as { inputPerImageUsd?: unknown; outputPerImageUsd?: unknown };
      const inputPerImageUsd = toNonNegativeNumber(rateRaw.inputPerImageUsd);
      const outputPerImageUsd = toNonNegativeNumber(rateRaw.outputPerImageUsd);
      if (inputPerImageUsd === null || outputPerImageUsd === null) continue;
      imageRatesByModel[model] = { inputPerImageUsd, outputPerImageUsd };
      hasMapOverride = true;
    }
  }

  const legacyInput = toNonNegativeNumber(raw.gemini?.imageInputPerImageUsd);
  const legacyOutput = toNonNegativeNumber(raw.gemini?.imageOutputPerImageUsd);
  if (legacyInput !== null && legacyOutput !== null) {
    const legacyRate = { inputPerImageUsd: legacyInput, outputPerImageUsd: legacyOutput };
    if (!hasMapOverride) {
      for (const model of Object.keys(imageRatesByModel)) {
        imageRatesByModel[model] = legacyRate;
      }
    }
    imageRatesByModel[imageModel] = legacyRate;
  }

  for (const model of KNOWN_GEMINI_IMAGE_MODELS) {
    if (!imageRatesByModel[model]) {
      imageRatesByModel[model] = { ...DEFAULT_IMAGE_COST_RATE };
    }
  }

  const gemini = {
    ttsModel:
      typeof raw.gemini?.ttsModel === 'string' && raw.gemini.ttsModel.trim().length > 0
        ? raw.gemini.ttsModel
        : base.gemini.ttsModel,
    ttsInputPer1MTokensUsd:
      toNonNegativeNumber(raw.gemini?.ttsInputPer1MTokensUsd) ??
      base.gemini.ttsInputPer1MTokensUsd,
    ttsOutputPer1MTokensUsd:
      toNonNegativeNumber(raw.gemini?.ttsOutputPer1MTokensUsd) ??
      base.gemini.ttsOutputPer1MTokensUsd,
    imageModel,
    imageRatesByModel,
    imageInputPerImageUsd: legacyInput ?? undefined,
    imageOutputPerImageUsd: legacyOutput ?? undefined,
  };

  return {
    currency: 'USD',
    openai,
    gemini,
  };
}

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
      const rate = resolveImageCostRate(record.model, rates);
      return count * (rate.inputPerImageUsd + rate.outputPerImageUsd);
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
