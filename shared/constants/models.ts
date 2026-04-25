export const TEXT_COMPLETION_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.2',
  'gemini-3.1-pro',
] as const;
export type TextCompletionModel = (typeof TEXT_COMPLETION_MODELS)[number];

export const OPENAI_TEXT_COMPLETION_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.2'] as const;
export const GEMINI_TEXT_COMPLETION_MODELS = ['gemini-3.1-pro'] as const;
export type OpenAITextCompletionModel = (typeof OPENAI_TEXT_COMPLETION_MODELS)[number];
export type GeminiTextCompletionModel = (typeof GEMINI_TEXT_COMPLETION_MODELS)[number];
export type TextCompletionProvider = 'openai' | 'gemini';

export const OPENAI_TEXT_COMPLETION_MODEL: TextCompletionModel = 'gpt-5.2';
export const DEFAULT_SCRIPT_TEXT_MODEL: TextCompletionModel = OPENAI_TEXT_COMPLETION_MODEL;
export const DEFAULT_IMAGE_PROMPT_TEXT_MODEL: TextCompletionModel = OPENAI_TEXT_COMPLETION_MODEL;
export const GEMINI_TEXT_COMPLETION_MODEL: TextCompletionModel = 'gemini-3.1-pro';

export const OPENAI_REASONING_EFFORTS = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;
export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

export const GEMINI_THINKING_LEVELS = ['default', 'low', 'medium', 'high'] as const;
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVELS)[number];
export type SelectableOpenAIReasoningEffort = Exclude<OpenAIReasoningEffort, 'default'>;
export type SelectableGeminiThinkingLevel = Exclude<GeminiThinkingLevel, 'default'>;

export const OPENAI_IMAGE_MODELS = ['gpt-image-2'] as const;
export const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
] as const;
export const IMAGE_MODELS = [...OPENAI_IMAGE_MODELS, ...GEMINI_IMAGE_MODELS] as const;
export type OpenAIImageModel = (typeof OPENAI_IMAGE_MODELS)[number];
export type GeminiImageModel = (typeof GEMINI_IMAGE_MODELS)[number];
export type ImageModel = (typeof IMAGE_MODELS)[number];
export type ImageModelProvider = 'openai' | 'gemini';
export const DEFAULT_IMAGE_MODEL: ImageModel = 'gemini-3.1-flash-image-preview';

export const IMAGE_RESOLUTIONS = ['fhd', '2k', '4k'] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = 'fhd';
export const IMAGE_SIZE_TIERS = ['1K', '2K', '4K'] as const;
export type ImageSizeTier = (typeof IMAGE_SIZE_TIERS)[number];

export const TEXT_COMPLETION_MODEL_LABELS: Record<TextCompletionModel, string> = {
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.2': 'GPT-5.2',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
};

export const IMAGE_MODEL_LABELS: Record<ImageModel, string> = {
  'gpt-image-2': 'GPT Image 2',
  'gemini-3.1-flash-image-preview': 'Gemini 3.1 Flash Image',
  'gemini-3-pro-image-preview': 'Gemini 3 Pro Image',
};

export const IMAGE_RESOLUTION_LABELS: Record<ImageResolution, string> = {
  fhd: 'Full HD 相当 (16:9=1920x1080)',
  '2k': '2K 相当 (16:9=2560x1440)',
  '4k': '4K 相当 (16:9=3840x2160)',
};

export const GEMINI_TTS_MODELS = [
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-flash-preview-tts',
] as const;
export type GeminiTtsModel = (typeof GEMINI_TTS_MODELS)[number];

export const GEMINI_TTS_MODEL_LABELS: Record<GeminiTtsModel, string> = {
  'gemini-2.5-pro-preview-tts': 'Gemini 2.5 Pro TTS Preview',
  'gemini-2.5-flash-preview-tts': 'Gemini 2.5 Flash TTS Preview',
};

export const DEFAULT_GEMINI_TTS_MODEL: GeminiTtsModel = 'gemini-2.5-pro-preview-tts';

const TEXT_COMPLETION_MODEL_SET = new Set<string>(TEXT_COMPLETION_MODELS);
const OPENAI_TEXT_COMPLETION_MODEL_SET = new Set<string>(OPENAI_TEXT_COMPLETION_MODELS);
const GEMINI_TEXT_COMPLETION_MODEL_SET = new Set<string>(GEMINI_TEXT_COMPLETION_MODELS);
const OPENAI_REASONING_EFFORT_SET = new Set<string>(OPENAI_REASONING_EFFORTS);
const GEMINI_THINKING_LEVEL_SET = new Set<string>(GEMINI_THINKING_LEVELS);
const OPENAI_IMAGE_MODEL_SET = new Set<string>(OPENAI_IMAGE_MODELS);
const GEMINI_IMAGE_MODEL_SET = new Set<string>(GEMINI_IMAGE_MODELS);
const IMAGE_MODEL_SET = new Set<string>(IMAGE_MODELS);
const IMAGE_RESOLUTION_SET = new Set<string>(IMAGE_RESOLUTIONS);
const GEMINI_TTS_MODEL_SET = new Set<string>(GEMINI_TTS_MODELS);

export function isTextCompletionModel(value: unknown): value is TextCompletionModel {
  return typeof value === 'string' && TEXT_COMPLETION_MODEL_SET.has(value);
}

export function getTextCompletionModelLabel(model: TextCompletionModel): string {
  return TEXT_COMPLETION_MODEL_LABELS[model];
}

export function isOpenAITextCompletionModel(value: unknown): value is OpenAITextCompletionModel {
  return typeof value === 'string' && OPENAI_TEXT_COMPLETION_MODEL_SET.has(value);
}

export function isGeminiTextCompletionModel(value: unknown): value is GeminiTextCompletionModel {
  return typeof value === 'string' && GEMINI_TEXT_COMPLETION_MODEL_SET.has(value);
}

export function getTextCompletionModelProvider(model: TextCompletionModel): TextCompletionProvider {
  return isOpenAITextCompletionModel(model) ? 'openai' : 'gemini';
}

export function isOpenAIReasoningEffort(value: unknown): value is OpenAIReasoningEffort {
  return typeof value === 'string' && OPENAI_REASONING_EFFORT_SET.has(value);
}

export function isGeminiThinkingLevel(value: unknown): value is GeminiThinkingLevel {
  return typeof value === 'string' && GEMINI_THINKING_LEVEL_SET.has(value);
}

const OPENAI_REASONING_EFFORTS_BY_MODEL: Record<
  OpenAITextCompletionModel,
  readonly SelectableOpenAIReasoningEffort[]
> = {
  'gpt-5.5': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.4': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.2': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
};

const OPENAI_TEMPERATURE_SUPPORTED_EFFORTS_BY_MODEL: Record<
  OpenAITextCompletionModel,
  readonly SelectableOpenAIReasoningEffort[]
> = {
  'gpt-5.5': ['none'],
  'gpt-5.4': ['none'],
  'gpt-5.2': ['none'],
};

const GEMINI_THINKING_LEVELS_BY_MODEL: Record<
  GeminiTextCompletionModel,
  readonly SelectableGeminiThinkingLevel[]
> = {
  'gemini-3.1-pro': ['low', 'medium', 'high'],
};

export function getSupportedOpenAIReasoningEfforts(
  model: OpenAITextCompletionModel
): readonly SelectableOpenAIReasoningEffort[] {
  return OPENAI_REASONING_EFFORTS_BY_MODEL[model];
}

export function supportsOpenAITemperature(
  model: OpenAITextCompletionModel,
  reasoningEffort: OpenAIReasoningEffort | null
): boolean {
  if (!reasoningEffort || reasoningEffort === 'default') {
    return false;
  }
  return OPENAI_TEMPERATURE_SUPPORTED_EFFORTS_BY_MODEL[model].includes(reasoningEffort);
}

export function getDefaultOpenAIReasoningEffort(
  model: OpenAITextCompletionModel
): SelectableOpenAIReasoningEffort {
  return OPENAI_REASONING_EFFORTS_BY_MODEL[model][0];
}

export function getSupportedGeminiThinkingLevels(
  model: GeminiTextCompletionModel
): readonly SelectableGeminiThinkingLevel[] {
  return GEMINI_THINKING_LEVELS_BY_MODEL[model];
}

export function getDefaultGeminiThinkingLevel(
  model: GeminiTextCompletionModel
): SelectableGeminiThinkingLevel {
  return model === 'gemini-3.1-pro' ? 'high' : GEMINI_THINKING_LEVELS_BY_MODEL[model][0];
}

export function isImageModel(value: unknown): value is ImageModel {
  return typeof value === 'string' && IMAGE_MODEL_SET.has(value);
}

export function isOpenAIImageModel(value: unknown): value is OpenAIImageModel {
  return typeof value === 'string' && OPENAI_IMAGE_MODEL_SET.has(value);
}

export function isGeminiImageModel(value: unknown): value is GeminiImageModel {
  return typeof value === 'string' && GEMINI_IMAGE_MODEL_SET.has(value);
}

export function getImageModelLabel(model: ImageModel): string {
  return IMAGE_MODEL_LABELS[model];
}

export function getImageModelProvider(model: ImageModel): ImageModelProvider {
  return isOpenAIImageModel(model) ? 'openai' : 'gemini';
}

export function isImageResolution(value: unknown): value is ImageResolution {
  return typeof value === 'string' && IMAGE_RESOLUTION_SET.has(value);
}

export function isGeminiTtsModel(value: unknown): value is GeminiTtsModel {
  return typeof value === 'string' && GEMINI_TTS_MODEL_SET.has(value);
}

export function getGeminiTtsModelLabel(model: GeminiTtsModel): string {
  return GEMINI_TTS_MODEL_LABELS[model];
}
