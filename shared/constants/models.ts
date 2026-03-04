export const TEXT_COMPLETION_MODELS = ['gpt-5.2', 'gemini-3.1-pro'] as const;
export type TextCompletionModel = (typeof TEXT_COMPLETION_MODELS)[number];

export const OPENAI_TEXT_COMPLETION_MODEL: TextCompletionModel = 'gpt-5.2';
export const DEFAULT_SCRIPT_TEXT_MODEL: TextCompletionModel = OPENAI_TEXT_COMPLETION_MODEL;
export const DEFAULT_IMAGE_PROMPT_TEXT_MODEL: TextCompletionModel = OPENAI_TEXT_COMPLETION_MODEL;
export const GEMINI_TEXT_COMPLETION_MODEL: TextCompletionModel = 'gemini-3.1-pro';

export const IMAGE_MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];
export const DEFAULT_IMAGE_MODEL: ImageModel = 'gemini-3.1-flash-image-preview';

export const IMAGE_RESOLUTIONS = ['fhd', '2k', '4k'] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = 'fhd';

export const IMAGE_RESOLUTION_LABELS: Record<ImageResolution, string> = {
  fhd: 'Full HD 相当 (16:9=1920x1080)',
  '2k': '2K 相当 (16:9=2560x1440)',
  '4k': '4K 相当 (16:9=3840x2160)',
};

export const FIXED_IMAGE_STYLE_PRESET = 'infographic' as const;
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-2.5-pro-preview-tts' as const;

const TEXT_COMPLETION_MODEL_SET = new Set<string>(TEXT_COMPLETION_MODELS);
const IMAGE_MODEL_SET = new Set<string>(IMAGE_MODELS);
const IMAGE_RESOLUTION_SET = new Set<string>(IMAGE_RESOLUTIONS);

export function isTextCompletionModel(value: unknown): value is TextCompletionModel {
  return typeof value === 'string' && TEXT_COMPLETION_MODEL_SET.has(value);
}

export function isImageModel(value: unknown): value is ImageModel {
  return typeof value === 'string' && IMAGE_MODEL_SET.has(value);
}

export function isImageResolution(value: unknown): value is ImageResolution {
  return typeof value === 'string' && IMAGE_RESOLUTION_SET.has(value);
}
