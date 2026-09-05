import { readingEntrySchema, type ReadingEntry } from '../project/narration';
import { z } from 'zod';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_PROMPT_TEXT_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  DEFAULT_SCRIPT_TEXT_MODEL,
  GEMINI_THINKING_LEVELS,
  GEMINI_TTS_MODELS,
  IMAGE_MODELS,
  IMAGE_RESOLUTIONS,
  OPENAI_REASONING_EFFORTS,
  OPENAI_TEXT_COMPLETION_MODELS,
  TEXT_COMPLETION_MODELS,
  getDefaultGeminiThinkingLevel,
  getDefaultOpenAIReasoningEffort,
  getCommonSupportedOpenAIReasoningEfforts,
  isGeminiThinkingLevel,
  isGeminiTtsModel,
  isImageModel,
  isImageResolution,
  isOpenAIReasoningEffort,
  isOpenAITextCompletionModel,
  isTextCompletionModel,
  type GeminiThinkingLevel,
  type GeminiTtsModel,
  type ImageModel,
  type ImageResolution,
  type OpenAIReasoningEffort,
  type SelectableOpenAIReasoningEffort,
  type OpenAITextCompletionModel,
  type TextCompletionModel,
} from '../constants/models';

export const TTS_ENGINES = ['google_tts', 'gemini_tts', 'macos_tts'] as const;
export type TTSEngine = (typeof TTS_ENGINES)[number];

export type AppSettings = {
  readingDictionary: ReadingEntry[];
  generationConcurrency: number;
  ttsEngine: TTSEngine;
  ttsModel: GeminiTtsModel;
  ttsVoice: string;
  ttsSpeakingRate: number;
  ttsPitch: number;
  scriptTextModel: TextCompletionModel;
  imagePromptTextModel: TextCompletionModel;
  openaiReasoningEffort: OpenAIReasoningEffort;
  geminiThinkingLevel: GeminiThinkingLevel;
  imageModel: ImageModel;
  imageResolution: ImageResolution;
  defaultAspectRatio: '16:9' | '1:1' | '9:16';
  videoResolution: '1920x1080' | '1280x720' | '3840x2160';
  videoFps: number;
  videoBitrate: string;
  audioBitrate: string;
  videoPartLeadInSec: number;
  openingVideoPath: string;
  endingVideoPath: string;
  defaultProjectDir: string;
  cost?: unknown;
};

export const DEFAULT_SETTINGS: AppSettings = {
  readingDictionary: [],
  generationConcurrency: 2,
  ttsEngine: 'gemini_tts',
  ttsModel: DEFAULT_GEMINI_TTS_MODEL,
  ttsVoice: 'Charon',
  ttsSpeakingRate: 1.0,
  ttsPitch: 0,
  scriptTextModel: DEFAULT_SCRIPT_TEXT_MODEL,
  imagePromptTextModel: DEFAULT_IMAGE_PROMPT_TEXT_MODEL,
  openaiReasoningEffort: getDefaultOpenAIReasoningEffort('gpt-5.2'),
  geminiThinkingLevel: getDefaultGeminiThinkingLevel('gemini-3.1-pro'),
  imageModel: DEFAULT_IMAGE_MODEL,
  imageResolution: DEFAULT_IMAGE_RESOLUTION,
  defaultAspectRatio: '16:9',
  videoResolution: '1920x1080',
  videoFps: 30,
  videoBitrate: '8M',
  audioBitrate: '192k',
  videoPartLeadInSec: 0.3,
  openingVideoPath: '',
  endingVideoPath: '',
  defaultProjectDir: '',
};

export const settingsUpdateSchema = z
  .object({
    readingDictionary: z.array(readingEntrySchema).max(500).optional(),
    generationConcurrency: z.number().int().min(1).max(4).optional(),
    ttsEngine: z.enum(TTS_ENGINES).optional(),
    ttsModel: z.enum(GEMINI_TTS_MODELS).optional(),
    ttsVoice: z.string().optional(),
    ttsSpeakingRate: z.number().finite().optional(),
    ttsPitch: z.number().finite().optional(),
    scriptTextModel: z.enum(TEXT_COMPLETION_MODELS).optional(),
    imagePromptTextModel: z.enum(TEXT_COMPLETION_MODELS).optional(),
    openaiReasoningEffort: z.enum(OPENAI_REASONING_EFFORTS).optional(),
    geminiThinkingLevel: z.enum(GEMINI_THINKING_LEVELS).optional(),
    imageModel: z.enum(IMAGE_MODELS).optional(),
    imageResolution: z.enum(IMAGE_RESOLUTIONS).optional(),
    defaultAspectRatio: z.enum(['16:9', '1:1', '9:16']).optional(),
    videoResolution: z.enum(['1920x1080', '1280x720', '3840x2160']).optional(),
    videoFps: z.number().finite().optional(),
    videoBitrate: z.string().optional(),
    audioBitrate: z.string().optional(),
    videoPartLeadInSec: z.number().finite().optional(),
    openingVideoPath: z.string().optional(),
    endingVideoPath: z.string().optional(),
    defaultProjectDir: z.string().optional(),
    cost: z.unknown().optional(),
  })
  .strip();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export function parseSettingsUpdate(input: unknown): SettingsUpdate {
  return settingsUpdateSchema.parse(input);
}

function resolveSettingsOpenAIModel(settings: {
  scriptTextModel: TextCompletionModel;
  imagePromptTextModel: TextCompletionModel;
}): OpenAITextCompletionModel {
  if (isOpenAITextCompletionModel(settings.scriptTextModel)) {
    return settings.scriptTextModel;
  }
  if (isOpenAITextCompletionModel(settings.imagePromptTextModel)) {
    return settings.imagePromptTextModel;
  }
  if (isOpenAITextCompletionModel(DEFAULT_SCRIPT_TEXT_MODEL)) {
    return DEFAULT_SCRIPT_TEXT_MODEL;
  }
  return OPENAI_TEXT_COMPLETION_MODELS[0];
}

function getCommonSettingsOpenAIReasoningEfforts(settings: {
  scriptTextModel: TextCompletionModel;
  imagePromptTextModel: TextCompletionModel;
}): readonly SelectableOpenAIReasoningEffort[] {
  const models = [settings.scriptTextModel, settings.imagePromptTextModel].filter(
    (model, index, values): model is OpenAITextCompletionModel =>
      isOpenAITextCompletionModel(model) && values.indexOf(model) === index
  );
  if (models.length === 0) return [];

  return getCommonSupportedOpenAIReasoningEfforts(models);
}

export function normalizeSettings(input: unknown): AppSettings {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const merged = { ...DEFAULT_SETTINGS, ...(raw as Partial<AppSettings>) };

  merged.readingDictionary = z
    .array(readingEntrySchema)
    .max(500)
    .catch([])
    .parse(merged.readingDictionary);
  merged.generationConcurrency = Number.isFinite(merged.generationConcurrency)
    ? Math.max(1, Math.min(4, Math.round(merged.generationConcurrency)))
    : 2;

  // 旧ボイス名の移行
  if (merged.ttsVoice === 'ja-JP-Chirp3-HD-Aoife') {
    merged.ttsVoice = DEFAULT_SETTINGS.ttsVoice;
  }

  // 本アプリでは Gemini TTS をデフォルト運用にする
  merged.ttsEngine = 'gemini_tts';

  if (!isGeminiTtsModel(merged.ttsModel)) {
    merged.ttsModel = DEFAULT_SETTINGS.ttsModel;
  }

  // 旧Google/macos系のボイス名が残っている場合はGemini側のデフォルトへ寄せる
  if (!merged.ttsVoice || merged.ttsVoice.includes('-')) {
    merged.ttsVoice = DEFAULT_SETTINGS.ttsVoice;
  }

  if (!isImageModel(merged.imageModel)) {
    merged.imageModel = DEFAULT_SETTINGS.imageModel;
  }
  if (!isImageResolution(merged.imageResolution)) {
    merged.imageResolution = DEFAULT_SETTINGS.imageResolution;
  }
  if (!isTextCompletionModel(merged.scriptTextModel)) {
    merged.scriptTextModel = DEFAULT_SETTINGS.scriptTextModel;
  }
  if (!isTextCompletionModel(merged.imagePromptTextModel)) {
    merged.imagePromptTextModel = DEFAULT_SETTINGS.imagePromptTextModel;
  }
  const openAIModel = resolveSettingsOpenAIModel(merged);
  const commonOpenAIEfforts = getCommonSettingsOpenAIReasoningEfforts(merged);
  const savedOpenAIEffort = merged.openaiReasoningEffort;
  if (
    !isOpenAIReasoningEffort(savedOpenAIEffort) ||
    savedOpenAIEffort === 'default' ||
    (commonOpenAIEfforts.length > 0 &&
      !commonOpenAIEfforts.includes(savedOpenAIEffort as SelectableOpenAIReasoningEffort))
  ) {
    const modelDefault = getDefaultOpenAIReasoningEffort(openAIModel);
    merged.openaiReasoningEffort = commonOpenAIEfforts.includes(modelDefault)
      ? modelDefault
      : (commonOpenAIEfforts[0] ?? modelDefault);
  }
  if (!isGeminiThinkingLevel(merged.geminiThinkingLevel)) {
    merged.geminiThinkingLevel = DEFAULT_SETTINGS.geminiThinkingLevel;
  } else if (merged.geminiThinkingLevel === 'default') {
    merged.geminiThinkingLevel = getDefaultGeminiThinkingLevel('gemini-3.1-pro');
  }

  return merged;
}
