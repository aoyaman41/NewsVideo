import type { UsageRecord } from '../schemas';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_SCRIPT_TEXT_MODEL,
  IMAGE_MODELS,
  IMAGE_SIZE_TIERS,
  type ImageResolution,
  type ImageSizeTier,
} from '../../shared/constants/models';

type TokenRate = {
  inputPer1MTokensUsd: number;
  outputPer1MTokensUsd: number;
  cachedInputPer1MTokensUsd?: number;
  cacheWritePer1MTokensUsd?: number;
  longContextThresholdTokens?: number;
  longContextInputMultiplier?: number;
  longContextOutputMultiplier?: number;
};

type GeminiTextRate = TokenRate & {
  thresholdTokens?: number;
  inputOverThresholdPer1MTokensUsd?: number;
  outputOverThresholdPer1MTokensUsd?: number;
};

type GeminiImageRate = {
  billingMode: 'per_image' | 'per_token';
  textInputPer1MTokensUsd?: number;
  outputPer1MTokensUsd?: number;
  outputPerImageUsdBySize?: Record<ImageSizeTier, number>;
  fallbackOutputPerImageUsdBySize?: Partial<Record<ImageSizeTier, number>>;
  legacyInputPerImageUsd?: number;
};

export type CostRates = {
  currency: 'USD';
  openai: {
    defaultModel: string;
    textRatesByModel: Record<string, TokenRate>;
    model?: string;
    inputPer1MTokensUsd?: number;
    outputPer1MTokensUsd?: number;
    cachedInputPer1MTokensUsd?: number;
  };
  gemini: {
    defaultTextModel: string;
    textRatesByModel: Record<string, GeminiTextRate>;
    ttsModel: string;
    ttsRatesByModel: Record<string, TokenRate>;
    ttsInputPer1MTokensUsd?: number;
    ttsOutputPer1MTokensUsd?: number;
    imageModel: string;
    imageRatesByModel: Record<string, GeminiImageRate>;
    imageInputPerImageUsd?: number;
    imageOutputPerImageUsd?: number;
  };
};

const LEGACY_IMAGE_INPUT_PER_IMAGE_USD = 0.0011;
const LONG_CONTEXT_RATE_272K = {
  longContextThresholdTokens: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
} as const;
const GEMINI_FLASH_IMAGE_OUTPUT_PER_1M_TOKENS_USD = 30;
const GEMINI_FLASH_IMAGE_OUTPUT_TOKENS_BY_SIZE: Record<ImageSizeTier, number> = {
  '1K': 1290,
  '2K': 5160,
  '4K': 20640,
};

function createAreaScaledFlashImageFallback(): Record<ImageSizeTier, number> {
  return IMAGE_SIZE_TIERS.reduce(
    (acc, sizeTier) => {
      acc[sizeTier] =
        (GEMINI_FLASH_IMAGE_OUTPUT_TOKENS_BY_SIZE[sizeTier] *
          GEMINI_FLASH_IMAGE_OUTPUT_PER_1M_TOKENS_USD) /
        1_000_000;
      return acc;
    },
    {} as Record<ImageSizeTier, number>
  );
}

const DEFAULT_GEMINI_FLASH_IMAGE_FALLBACK = createAreaScaledFlashImageFallback();

function cloneSizeMap(
  value: Partial<Record<ImageSizeTier, number>> | undefined
): Partial<Record<ImageSizeTier, number>> | undefined {
  return value ? { ...value } : undefined;
}

function cloneImageRate(rate: GeminiImageRate): GeminiImageRate {
  return {
    ...rate,
    outputPerImageUsdBySize: rate.outputPerImageUsdBySize
      ? { ...rate.outputPerImageUsdBySize }
      : undefined,
    fallbackOutputPerImageUsdBySize: cloneSizeMap(rate.fallbackOutputPerImageUsdBySize),
  };
}

const DEFAULT_OPENAI_TEXT_RATES: Record<string, TokenRate> = {
  'gpt-6-astra': { inputPer1MTokensUsd: 10, cachedInputPer1MTokensUsd: 1, cacheWritePer1MTokensUsd: 12.5, outputPer1MTokensUsd: 50, ...LONG_CONTEXT_RATE_272K },
  'gpt-5.6-sol': {
    inputPer1MTokensUsd: 5,
    cachedInputPer1MTokensUsd: 0.5,
    cacheWritePer1MTokensUsd: 6.25,
    outputPer1MTokensUsd: 30,
    ...LONG_CONTEXT_RATE_272K,
  },
  'gpt-5.6-terra': {
    inputPer1MTokensUsd: 2.5,
    cachedInputPer1MTokensUsd: 0.25,
    cacheWritePer1MTokensUsd: 3.125,
    outputPer1MTokensUsd: 15,
    ...LONG_CONTEXT_RATE_272K,
  },
  'gpt-5.6-luna': {
    inputPer1MTokensUsd: 1,
    cachedInputPer1MTokensUsd: 0.1,
    cacheWritePer1MTokensUsd: 1.25,
    outputPer1MTokensUsd: 6,
    ...LONG_CONTEXT_RATE_272K,
  },
  'gpt-5.4': {
    inputPer1MTokensUsd: 2.5,
    cachedInputPer1MTokensUsd: 0.25,
    outputPer1MTokensUsd: 15.0,
    ...LONG_CONTEXT_RATE_272K,
  },
  'gpt-5.2': {
    inputPer1MTokensUsd: 1.75,
    cachedInputPer1MTokensUsd: 0.175,
    outputPer1MTokensUsd: 14.0,
  },
};

const DEFAULT_GEMINI_TEXT_RATES: Record<string, GeminiTextRate> = {
  'gemini-3.1-pro': {
    inputPer1MTokensUsd: 1.25,
    outputPer1MTokensUsd: 10.0,
    thresholdTokens: 200_000,
    inputOverThresholdPer1MTokensUsd: 2.5,
    outputOverThresholdPer1MTokensUsd: 15.0,
  },
  'gemini-3-pro-preview': {
    inputPer1MTokensUsd: 1.25,
    outputPer1MTokensUsd: 10.0,
    thresholdTokens: 200_000,
    inputOverThresholdPer1MTokensUsd: 2.5,
    outputOverThresholdPer1MTokensUsd: 15.0,
  },
};

const DEFAULT_GEMINI_TTS_RATES: Record<string, TokenRate> = {
  'gemini-2.5-pro-preview-tts': {
    inputPer1MTokensUsd: 1.0,
    outputPer1MTokensUsd: 20.0,
  },
};

const DEFAULT_GEMINI_IMAGE_RATES: Record<string, GeminiImageRate> = {
  'gemini-3.1-flash-image-preview': {
    billingMode: 'per_token',
    textInputPer1MTokensUsd: 0.3,
    outputPer1MTokensUsd: GEMINI_FLASH_IMAGE_OUTPUT_PER_1M_TOKENS_USD,
    fallbackOutputPerImageUsdBySize: DEFAULT_GEMINI_FLASH_IMAGE_FALLBACK,
    legacyInputPerImageUsd: LEGACY_IMAGE_INPUT_PER_IMAGE_USD,
  },
  'gemini-3-pro-image-preview': {
    billingMode: 'per_image',
    textInputPer1MTokensUsd: 0.3,
    outputPerImageUsdBySize: {
      '1K': 0.02,
      '2K': 0.039,
      '4K': 0.16,
    },
    legacyInputPerImageUsd: LEGACY_IMAGE_INPUT_PER_IMAGE_USD,
  },
};

export const DEFAULT_COST_RATES: CostRates = {
  currency: 'USD',
  openai: {
    defaultModel: DEFAULT_SCRIPT_TEXT_MODEL,
    textRatesByModel: { ...DEFAULT_OPENAI_TEXT_RATES },
  },
  gemini: {
    defaultTextModel: 'gemini-3.1-pro',
    textRatesByModel: { ...DEFAULT_GEMINI_TEXT_RATES },
    ttsModel: 'gemini-2.5-pro-preview-tts',
    ttsRatesByModel: { ...DEFAULT_GEMINI_TTS_RATES },
    imageModel: DEFAULT_IMAGE_MODEL,
    imageRatesByModel: Object.fromEntries(
      Object.entries(DEFAULT_GEMINI_IMAGE_RATES).map(([model, rate]) => [
        model,
        cloneImageRate(rate),
      ])
    ),
  },
};

function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function resolveImageSizeTier(
  imageSizeTier?: ImageSizeTier,
  imageResolution?: ImageResolution
): ImageSizeTier {
  if (imageSizeTier) return imageSizeTier;
  if (imageResolution === '4k') return '4K';
  if (imageResolution === '2k') return '2K';
  return '1K';
}

function cloneTokenRates<T extends TokenRate>(rates: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(rates).map(([model, rate]) => [model, { ...rate } as T])
  );
}

function cloneImageRates(rates: Record<string, GeminiImageRate>): Record<string, GeminiImageRate> {
  return Object.fromEntries(
    Object.entries(rates).map(([model, rate]) => [model, cloneImageRate(rate)])
  );
}

function resolveRecordMapRate<T>(
  model: string | undefined,
  fallbackModel: string,
  rates: Record<string, T>
): T {
  if (model && rates[model]) return rates[model];
  if (rates[fallbackModel]) return rates[fallbackModel];
  const first = Object.values(rates)[0];
  if (!first) {
    throw new Error('料金表が設定されていません');
  }
  return first;
}

const OPENAI_MODEL_RATE_ALIASES: Readonly<Record<string, string>> = {
  'gpt-5.6': 'gpt-5.6-sol',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveOpenAIModelRateKey(
  model: string | undefined,
  rates: Record<string, TokenRate>
): string | null {
  if (!model) return null;
  if (rates[model]) return model;

  const alias = OPENAI_MODEL_RATE_ALIASES[model];
  if (alias && rates[alias]) return alias;

  const datedAlias = model.match(/^(gpt-5\.6)-(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (datedAlias) {
    const canonical = OPENAI_MODEL_RATE_ALIASES[datedAlias];
    if (canonical && rates[canonical]) return canonical;
  }

  const datedCanonical = Object.keys(rates)
    .sort((a, b) => b.length - a.length)
    .find((rateModel) =>
      new RegExp(`^${escapeRegExp(rateModel)}-\\d{4}-\\d{2}-\\d{2}$`).test(model)
    );
  return datedCanonical ?? null;
}

function resolveOpenAITextRate(
  model: string | undefined,
  fallbackModel: string,
  rates: Record<string, TokenRate>
): TokenRate {
  const modelKey = resolveOpenAIModelRateKey(model, rates);
  if (modelKey) return rates[modelKey];

  const fallbackKey = resolveOpenAIModelRateKey(fallbackModel, rates);
  if (fallbackKey) return rates[fallbackKey];

  return resolveRecordMapRate(undefined, fallbackModel, rates);
}

function parseTokenRate(input: unknown, withCache: boolean): TokenRate | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const inputPer1MTokensUsd = toNonNegativeNumber(raw.inputPer1MTokensUsd);
  const outputPer1MTokensUsd = toNonNegativeNumber(raw.outputPer1MTokensUsd);
  if (inputPer1MTokensUsd === null || outputPer1MTokensUsd === null) return null;
  const cachedInputPer1MTokensUsd = withCache
    ? (toNonNegativeNumber(raw.cachedInputPer1MTokensUsd) ?? undefined)
    : undefined;
  const cacheWritePer1MTokensUsd = withCache
    ? (toNonNegativeNumber(raw.cacheWritePer1MTokensUsd) ?? undefined)
    : undefined;
  const longContextThresholdTokens =
    toNonNegativeNumber(raw.longContextThresholdTokens) ?? undefined;
  const longContextInputMultiplier =
    toNonNegativeNumber(raw.longContextInputMultiplier) ?? undefined;
  const longContextOutputMultiplier =
    toNonNegativeNumber(raw.longContextOutputMultiplier) ?? undefined;
  return {
    inputPer1MTokensUsd,
    outputPer1MTokensUsd,
    ...(cachedInputPer1MTokensUsd !== undefined ? { cachedInputPer1MTokensUsd } : {}),
    ...(cacheWritePer1MTokensUsd !== undefined ? { cacheWritePer1MTokensUsd } : {}),
    ...(longContextThresholdTokens !== undefined ? { longContextThresholdTokens } : {}),
    ...(longContextInputMultiplier !== undefined ? { longContextInputMultiplier } : {}),
    ...(longContextOutputMultiplier !== undefined ? { longContextOutputMultiplier } : {}),
  };
}

function parseGeminiTextRate(input: unknown): GeminiTextRate | null {
  const base = parseTokenRate(input, false);
  if (!base || !input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  return {
    ...base,
    thresholdTokens: toNonNegativeNumber(raw.thresholdTokens) ?? undefined,
    inputOverThresholdPer1MTokensUsd:
      toNonNegativeNumber(raw.inputOverThresholdPer1MTokensUsd) ?? undefined,
    outputOverThresholdPer1MTokensUsd:
      toNonNegativeNumber(raw.outputOverThresholdPer1MTokensUsd) ?? undefined,
  };
}

function parseSizeMap(input: unknown): Partial<Record<ImageSizeTier, number>> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const parsed: Partial<Record<ImageSizeTier, number>> = {};
  for (const sizeTier of IMAGE_SIZE_TIERS) {
    const value = toNonNegativeNumber(raw[sizeTier]);
    if (value !== null) parsed[sizeTier] = value;
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function fillMissingSizeRates(
  source: Partial<Record<ImageSizeTier, number>> | undefined,
  fallback: Partial<Record<ImageSizeTier, number>> | undefined
): Record<ImageSizeTier, number> | undefined {
  const resolved: Partial<Record<ImageSizeTier, number>> = {};
  for (const sizeTier of IMAGE_SIZE_TIERS) {
    const value = source?.[sizeTier] ?? fallback?.[sizeTier];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      resolved[sizeTier] = value;
    }
  }
  return IMAGE_SIZE_TIERS.every((sizeTier) => typeof resolved[sizeTier] === 'number')
    ? (resolved as Record<ImageSizeTier, number>)
    : undefined;
}

function parseGeminiImageRate(input: unknown): GeminiImageRate | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const billingMode =
    raw.billingMode === 'per_token'
      ? 'per_token'
      : raw.billingMode === 'per_image'
        ? 'per_image'
        : null;
  if (!billingMode) return null;

  const textInputPer1MTokensUsd = toNonNegativeNumber(raw.textInputPer1MTokensUsd) ?? undefined;
  const outputPer1MTokensUsd = toNonNegativeNumber(raw.outputPer1MTokensUsd) ?? undefined;
  const legacyInputPerImageUsd = toNonNegativeNumber(raw.legacyInputPerImageUsd) ?? undefined;
  const outputPerImageUsdBySize = fillMissingSizeRates(
    parseSizeMap(raw.outputPerImageUsdBySize),
    undefined
  );
  const fallbackOutputPerImageUsdBySize = parseSizeMap(raw.fallbackOutputPerImageUsdBySize);

  return {
    billingMode,
    textInputPer1MTokensUsd,
    outputPer1MTokensUsd,
    outputPerImageUsdBySize,
    fallbackOutputPerImageUsdBySize,
    legacyInputPerImageUsd,
  };
}

function getImageOutputPerImageUsd(rate: GeminiImageRate, sizeTier: ImageSizeTier): number {
  const exact = rate.outputPerImageUsdBySize?.[sizeTier];
  if (typeof exact === 'number') return exact;

  const fallback = rate.fallbackOutputPerImageUsdBySize?.[sizeTier];
  if (typeof fallback === 'number') return fallback;

  const firstDefined =
    Object.values(rate.outputPerImageUsdBySize ?? {}).find((value) => typeof value === 'number') ??
    Object.values(rate.fallbackOutputPerImageUsdBySize ?? {}).find(
      (value) => typeof value === 'number'
    );
  return typeof firstDefined === 'number' ? firstDefined : 0;
}

export function normalizeCostRates(input?: unknown): CostRates {
  const base = DEFAULT_COST_RATES;
  if (!input || typeof input !== 'object') return base;

  const raw = input as {
    openai?: {
      defaultModel?: unknown;
      textRatesByModel?: unknown;
      model?: unknown;
      inputPer1MTokensUsd?: unknown;
      outputPer1MTokensUsd?: unknown;
      cachedInputPer1MTokensUsd?: unknown;
    };
    gemini?: {
      defaultTextModel?: unknown;
      textRatesByModel?: unknown;
      ttsModel?: unknown;
      ttsRatesByModel?: unknown;
      ttsInputPer1MTokensUsd?: unknown;
      ttsOutputPer1MTokensUsd?: unknown;
      imageModel?: unknown;
      imageRatesByModel?: unknown;
      imageInputPerImageUsd?: unknown;
      imageOutputPerImageUsd?: unknown;
    };
  };

  const openaiDefaultModel =
    typeof raw.openai?.defaultModel === 'string' && raw.openai.defaultModel.trim().length > 0
      ? raw.openai.defaultModel
      : typeof raw.openai?.model === 'string' && raw.openai.model.trim().length > 0
        ? raw.openai.model
        : base.openai.defaultModel;
  const openaiTextRatesByModel = cloneTokenRates(base.openai.textRatesByModel);
  if (raw.openai?.textRatesByModel && typeof raw.openai.textRatesByModel === 'object') {
    for (const [model, rate] of Object.entries(
      raw.openai.textRatesByModel as Record<string, unknown>
    )) {
      const parsed = parseTokenRate(rate, true);
      if (parsed) {
        openaiTextRatesByModel[model] = {
          ...openaiTextRatesByModel[model],
          ...parsed,
        };
      }
    }
  }
  const legacyOpenAiRate = parseTokenRate(
    {
      inputPer1MTokensUsd: raw.openai?.inputPer1MTokensUsd,
      outputPer1MTokensUsd: raw.openai?.outputPer1MTokensUsd,
      cachedInputPer1MTokensUsd: raw.openai?.cachedInputPer1MTokensUsd,
    },
    true
  );
  if (legacyOpenAiRate) {
    openaiTextRatesByModel[openaiDefaultModel] = {
      ...openaiTextRatesByModel[openaiDefaultModel],
      ...legacyOpenAiRate,
    };
  }

  const geminiDefaultTextModel =
    typeof raw.gemini?.defaultTextModel === 'string' &&
    raw.gemini.defaultTextModel.trim().length > 0
      ? raw.gemini.defaultTextModel
      : base.gemini.defaultTextModel;
  const geminiTextRatesByModel = cloneTokenRates(base.gemini.textRatesByModel);
  if (raw.gemini?.textRatesByModel && typeof raw.gemini.textRatesByModel === 'object') {
    for (const [model, rate] of Object.entries(
      raw.gemini.textRatesByModel as Record<string, unknown>
    )) {
      const parsed = parseGeminiTextRate(rate);
      if (parsed) geminiTextRatesByModel[model] = parsed;
    }
  }

  const geminiTtsModel =
    typeof raw.gemini?.ttsModel === 'string' && raw.gemini.ttsModel.trim().length > 0
      ? raw.gemini.ttsModel
      : base.gemini.ttsModel;
  const geminiTtsRatesByModel = cloneTokenRates(base.gemini.ttsRatesByModel);
  if (raw.gemini?.ttsRatesByModel && typeof raw.gemini.ttsRatesByModel === 'object') {
    for (const [model, rate] of Object.entries(
      raw.gemini.ttsRatesByModel as Record<string, unknown>
    )) {
      const parsed = parseTokenRate(rate, false);
      if (parsed) geminiTtsRatesByModel[model] = parsed;
    }
  }
  const legacyTtsRate = parseTokenRate(
    {
      inputPer1MTokensUsd: raw.gemini?.ttsInputPer1MTokensUsd,
      outputPer1MTokensUsd: raw.gemini?.ttsOutputPer1MTokensUsd,
    },
    false
  );
  if (legacyTtsRate) {
    geminiTtsRatesByModel[geminiTtsModel] = legacyTtsRate;
  }

  const geminiImageModel =
    typeof raw.gemini?.imageModel === 'string' && raw.gemini.imageModel.trim().length > 0
      ? raw.gemini.imageModel
      : base.gemini.imageModel;
  const geminiImageRatesByModel = cloneImageRates(base.gemini.imageRatesByModel);
  if (raw.gemini?.imageRatesByModel && typeof raw.gemini.imageRatesByModel === 'object') {
    for (const [model, rate] of Object.entries(
      raw.gemini.imageRatesByModel as Record<string, unknown>
    )) {
      const parsed = parseGeminiImageRate(rate);
      if (parsed) geminiImageRatesByModel[model] = parsed;
    }
  }
  const legacyImageInputPerImageUsd = toNonNegativeNumber(raw.gemini?.imageInputPerImageUsd);
  const legacyImageOutputPerImageUsd = toNonNegativeNumber(raw.gemini?.imageOutputPerImageUsd);
  if (legacyImageInputPerImageUsd !== null && legacyImageOutputPerImageUsd !== null) {
    const baseRate = geminiImageRatesByModel[geminiImageModel] ?? {
      billingMode: 'per_image' as const,
    };
    geminiImageRatesByModel[geminiImageModel] = {
      ...baseRate,
      legacyInputPerImageUsd: legacyImageInputPerImageUsd,
      outputPerImageUsdBySize: {
        '1K': legacyImageOutputPerImageUsd,
        '2K': legacyImageOutputPerImageUsd,
        '4K': legacyImageOutputPerImageUsd,
      },
    };
  }

  for (const model of IMAGE_MODELS) {
    if (model === 'gpt-image-2') continue;
    if (!geminiImageRatesByModel[model]) {
      geminiImageRatesByModel[model] = cloneImageRate(
        DEFAULT_GEMINI_IMAGE_RATES[DEFAULT_IMAGE_MODEL]
      );
    }
  }

  return {
    currency: 'USD',
    openai: {
      defaultModel: openaiDefaultModel,
      textRatesByModel: openaiTextRatesByModel,
      model:
        typeof raw.openai?.model === 'string' && raw.openai.model.trim().length > 0
          ? raw.openai.model
          : undefined,
      inputPer1MTokensUsd: toNonNegativeNumber(raw.openai?.inputPer1MTokensUsd) ?? undefined,
      outputPer1MTokensUsd: toNonNegativeNumber(raw.openai?.outputPer1MTokensUsd) ?? undefined,
      cachedInputPer1MTokensUsd:
        toNonNegativeNumber(raw.openai?.cachedInputPer1MTokensUsd) ?? undefined,
    },
    gemini: {
      defaultTextModel: geminiDefaultTextModel,
      textRatesByModel: geminiTextRatesByModel,
      ttsModel: geminiTtsModel,
      ttsRatesByModel: geminiTtsRatesByModel,
      ttsInputPer1MTokensUsd: toNonNegativeNumber(raw.gemini?.ttsInputPer1MTokensUsd) ?? undefined,
      ttsOutputPer1MTokensUsd:
        toNonNegativeNumber(raw.gemini?.ttsOutputPer1MTokensUsd) ?? undefined,
      imageModel: geminiImageModel,
      imageRatesByModel: geminiImageRatesByModel,
      imageInputPerImageUsd: legacyImageInputPerImageUsd ?? undefined,
      imageOutputPerImageUsd: legacyImageOutputPerImageUsd ?? undefined,
    },
  };
}

export function estimateUsageCostUsd(record: UsageRecord, rates: CostRates): number {
  if (record.provider === 'openai' && record.category === 'image') {
    // Images API generation sends text only; no image-input charges apply.
    // Standard pricing: text input $5/M, image output $30/M (2026-09-05).
    if (record.model !== 'gpt-image-2') return 0;
    return (Math.max(0, record.inputTokens ?? 0) * 5 + Math.max(0, record.outputTokens ?? 0) * 30) / 1_000_000;
  }
  if (record.provider === 'openai') {
    const rate = resolveOpenAITextRate(
      record.model,
      rates.openai.defaultModel,
      rates.openai.textRatesByModel
    );
    const totalInputTokens = Math.max(0, record.inputTokens ?? 0);
    const cachedInputTokens = Math.max(
      0,
      Math.min(record.cachedInputTokens ?? 0, totalInputTokens)
    );
    const cacheWriteTokens = Math.max(
      0,
      Math.min(record.cacheWriteTokens ?? 0, totalInputTokens - cachedInputTokens)
    );
    const uncachedInputTokens = totalInputTokens - cachedInputTokens - cacheWriteTokens;
    const usesLongContextRate =
      record.requestCount === 1 &&
      typeof rate.longContextThresholdTokens === 'number' &&
      totalInputTokens > rate.longContextThresholdTokens;
    const inputMultiplier = usesLongContextRate ? (rate.longContextInputMultiplier ?? 1) : 1;
    const outputMultiplier = usesLongContextRate ? (rate.longContextOutputMultiplier ?? 1) : 1;
    const input = (uncachedInputTokens * rate.inputPer1MTokensUsd * inputMultiplier) / 1_000_000;
    const cachedInput =
      (cachedInputTokens *
        (rate.cachedInputPer1MTokensUsd ?? rate.inputPer1MTokensUsd) *
        inputMultiplier) /
      1_000_000;
    const cacheWrite =
      (cacheWriteTokens *
        (rate.cacheWritePer1MTokensUsd ?? rate.inputPer1MTokensUsd) *
        inputMultiplier) /
      1_000_000;
    const output =
      ((record.outputTokens ?? 0) * rate.outputPer1MTokensUsd * outputMultiplier) / 1_000_000;
    return input + cachedInput + cacheWrite + output;
  }

  if (record.provider !== 'gemini') {
    return 0;
  }

  if (record.category === 'text') {
    const rate = resolveRecordMapRate(
      record.model,
      rates.gemini.defaultTextModel,
      rates.gemini.textRatesByModel
    );
    const overThreshold =
      typeof rate.thresholdTokens === 'number' && (record.inputTokens ?? 0) > rate.thresholdTokens;
    const inputRate =
      overThreshold && typeof rate.inputOverThresholdPer1MTokensUsd === 'number'
        ? rate.inputOverThresholdPer1MTokensUsd
        : rate.inputPer1MTokensUsd;
    const outputRate =
      overThreshold && typeof rate.outputOverThresholdPer1MTokensUsd === 'number'
        ? rate.outputOverThresholdPer1MTokensUsd
        : rate.outputPer1MTokensUsd;
    const input = ((record.inputTokens ?? 0) * inputRate) / 1_000_000;
    const output = ((record.outputTokens ?? 0) * outputRate) / 1_000_000;
    return input + output;
  }

  if (record.category === 'tts') {
    const rate = resolveRecordMapRate(
      record.model,
      rates.gemini.ttsModel,
      rates.gemini.ttsRatesByModel
    );
    const input = ((record.inputTokens ?? 0) * rate.inputPer1MTokensUsd) / 1_000_000;
    const output = ((record.outputTokens ?? 0) * rate.outputPer1MTokensUsd) / 1_000_000;
    return input + output;
  }

  if (record.category === 'image') {
    const rate = resolveRecordMapRate(
      record.model,
      rates.gemini.imageModel,
      rates.gemini.imageRatesByModel
    );
    const count = Math.max(0, record.imageCount ?? 0);
    const sizeTier = resolveImageSizeTier(record.imageSizeTier, record.imageResolution);
    const input =
      typeof rate.textInputPer1MTokensUsd === 'number' && typeof record.inputTokens === 'number'
        ? (record.inputTokens * rate.textInputPer1MTokensUsd) / 1_000_000
        : count * (rate.legacyInputPerImageUsd ?? 0);

    let output = 0;
    if (
      rate.billingMode === 'per_token' &&
      typeof rate.outputPer1MTokensUsd === 'number' &&
      typeof record.outputTokens === 'number' &&
      record.outputTokens > 0
    ) {
      output = (record.outputTokens * rate.outputPer1MTokensUsd) / 1_000_000;
    } else {
      output = count * getImageOutputPerImageUsd(rate, sizeTier);
    }

    return input + output;
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
