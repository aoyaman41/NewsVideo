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
  TEXT_COMPLETION_MODELS,
  getDefaultGeminiThinkingLevel,
  getDefaultOpenAIReasoningEffort,
  isGeminiThinkingLevel,
  isGeminiTtsModel,
  isImageModel,
  isImageResolution,
  isOpenAIReasoningEffort,
  isTextCompletionModel,
  type GeminiThinkingLevel,
  type GeminiTtsModel,
  type ImageModel,
  type ImageResolution,
  type OpenAIReasoningEffort,
  type TextCompletionModel,
} from '../constants/models';

export const TTS_ENGINES = ['google_tts', 'gemini_tts', 'macos_tts'] as const;
export type TTSEngine = (typeof TTS_ENGINES)[number];

export type AppSettings = {
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

export function normalizeSettings(input: unknown): AppSettings {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const merged = { ...DEFAULT_SETTINGS, ...(raw as Partial<AppSettings>) };

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
  if (!isOpenAIReasoningEffort(merged.openaiReasoningEffort)) {
    merged.openaiReasoningEffort = DEFAULT_SETTINGS.openaiReasoningEffort;
  } else if (merged.openaiReasoningEffort === 'default') {
    merged.openaiReasoningEffort = getDefaultOpenAIReasoningEffort('gpt-5.2');
  }
  if (!isGeminiThinkingLevel(merged.geminiThinkingLevel)) {
    merged.geminiThinkingLevel = DEFAULT_SETTINGS.geminiThinkingLevel;
  } else if (merged.geminiThinkingLevel === 'default') {
    merged.geminiThinkingLevel = getDefaultGeminiThinkingLevel('gemini-3.1-pro');
  }

  return merged;
}
