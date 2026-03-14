export const TEXT_COMPLETION_MODELS = ['gpt-5.4', 'gpt-5.2', 'gemini-3.1-pro'] as const;
export type TextCompletionModel = (typeof TEXT_COMPLETION_MODELS)[number];

export const OPENAI_TEXT_COMPLETION_MODELS = ['gpt-5.4', 'gpt-5.2'] as const;
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
export type SelectableGeminiThinkingLevel = Exclude<GeminiThinkingLevel, 'default' | 'medium'>;

export const IMAGE_MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];
export const DEFAULT_IMAGE_MODEL: ImageModel = 'gemini-3.1-flash-image-preview';

export const IMAGE_RESOLUTIONS = ['fhd', '2k', '4k'] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = 'fhd';
export const IMAGE_SIZE_TIERS = ['1K', '2K', '4K'] as const;
export type ImageSizeTier = (typeof IMAGE_SIZE_TIERS)[number];

export const TEXT_COMPLETION_MODEL_LABELS: Record<TextCompletionModel, string> = {
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.2': 'GPT-5.2',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
};

export const IMAGE_MODEL_LABELS: Record<ImageModel, string> = {
  'gemini-3.1-flash-image-preview': 'Gemini 3.1 Flash Image',
  'gemini-3-pro-image-preview': 'Gemini 3 Pro Image',
};

export const IMAGE_RESOLUTION_LABELS: Record<ImageResolution, string> = {
  fhd: 'Full HD 相当 (16:9=1920x1080)',
  '2k': '2K 相当 (16:9=2560x1440)',
  '4k': '4K 相当 (16:9=3840x2160)',
};

export const FIXED_IMAGE_STYLE_PRESET = 'infographic' as const;
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-2.5-pro-preview-tts' as const;

const TEXT_COMPLETION_MODEL_SET = new Set<string>(TEXT_COMPLETION_MODELS);
const OPENAI_TEXT_COMPLETION_MODEL_SET = new Set<string>(OPENAI_TEXT_COMPLETION_MODELS);
const GEMINI_TEXT_COMPLETION_MODEL_SET = new Set<string>(GEMINI_TEXT_COMPLETION_MODELS);
const OPENAI_REASONING_EFFORT_SET = new Set<string>(OPENAI_REASONING_EFFORTS);
const GEMINI_THINKING_LEVEL_SET = new Set<string>(GEMINI_THINKING_LEVELS);
const IMAGE_MODEL_SET = new Set<string>(IMAGE_MODELS);
const IMAGE_RESOLUTION_SET = new Set<string>(IMAGE_RESOLUTIONS);

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
  'gpt-5.4': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.2': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
};

const OPENAI_TEMPERATURE_SUPPORTED_EFFORTS_BY_MODEL: Record<
  OpenAITextCompletionModel,
  readonly SelectableOpenAIReasoningEffort[]
> = {
  'gpt-5.4': ['none'],
  'gpt-5.2': ['none'],
};

const GEMINI_THINKING_LEVELS_BY_MODEL: Record<
  GeminiTextCompletionModel,
  readonly SelectableGeminiThinkingLevel[]
> = {
  'gemini-3.1-pro': ['low', 'high'],
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

export function getImageModelLabel(model: ImageModel): string {
  return IMAGE_MODEL_LABELS[model];
}

export function isImageResolution(value: unknown): value is ImageResolution {
  return typeof value === 'string' && IMAGE_RESOLUTION_SET.has(value);
}
