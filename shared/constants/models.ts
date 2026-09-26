export const OPENAI_TEXT_COMPLETION_MODELS = [
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.2',
] as const;
export const GEMINI_TEXT_COMPLETION_MODELS = ['gemini-3.1-pro'] as const;
export const ANTHROPIC_TEXT_COMPLETION_MODELS = ['claude-opus-5-5'] as const;
export const TEXT_COMPLETION_MODELS = [
  ...OPENAI_TEXT_COMPLETION_MODELS,
  ...GEMINI_TEXT_COMPLETION_MODELS,
  ...ANTHROPIC_TEXT_COMPLETION_MODELS,
] as const;
export type TextCompletionModel = (typeof TEXT_COMPLETION_MODELS)[number];
export type OpenAITextCompletionModel = (typeof OPENAI_TEXT_COMPLETION_MODELS)[number];
export type GeminiTextCompletionModel = (typeof GEMINI_TEXT_COMPLETION_MODELS)[number];
export type AnthropicTextCompletionModel = (typeof ANTHROPIC_TEXT_COMPLETION_MODELS)[number];
export type TextCompletionProvider = 'openai' | 'gemini' | 'anthropic';

export const OPENAI_TEXT_COMPLETION_MODEL: OpenAITextCompletionModel = 'gpt-5.2';
export const DEFAULT_SCRIPT_TEXT_MODEL: TextCompletionModel = OPENAI_TEXT_COMPLETION_MODEL;
export const DEFAULT_IMAGE_PROMPT_TEXT_MODEL: TextCompletionModel = OPENAI_TEXT_COMPLETION_MODEL;
export const GEMINI_TEXT_COMPLETION_MODEL: TextCompletionModel = 'gemini-3.1-pro';
export const ANTHROPIC_TEXT_COMPLETION_MODEL: AnthropicTextCompletionModel = 'claude-opus-5-5';

export const OPENAI_REASONING_EFFORTS = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

export const GEMINI_THINKING_LEVELS = ['default', 'low', 'medium', 'high'] as const;
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVELS)[number];
export type SelectableOpenAIReasoningEffort = Exclude<OpenAIReasoningEffort, 'default'>;
export type SelectableGeminiThinkingLevel = Exclude<GeminiThinkingLevel, 'default'>;

// Claude は thinking を無効化できないため、思考の深さは output_config.effort だけで制御する
export const CLAUDE_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
export type SelectableClaudeEffort = Exclude<ClaudeEffort, 'default'>;

export const OPENAI_IMAGE_MODELS = [
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2',
] as const;
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
  'gpt-6-astra': 'GPT-6 Astra',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.2': 'GPT-5.2',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'claude-opus-5-5': 'Claude Opus 5.5',
};

export const IMAGE_MODEL_LABELS: Record<ImageModel, string> = {
  'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst',
  'gpt-image-2.5-flare': 'GPT Image 2.5 Flare',
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
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-flash-preview-tts',
] as const;
export type GeminiTtsModel = (typeof GEMINI_TTS_MODELS)[number];

export const GEMINI_TTS_MODEL_LABELS: Record<GeminiTtsModel, string> = {
  'gemini-3.8-flash-tts': 'Gemini 3.8 Flash TTS',
  'gemini-3.8-flash-lite-tts': 'Gemini 3.8 Flash-Lite TTS',
  'gemini-3.1-flash-tts-preview': 'Gemini 3.1 Flash TTS Preview',
  'gemini-2.5-pro-preview-tts': 'Gemini 2.5 Pro TTS Preview',
  'gemini-2.5-flash-preview-tts': 'Gemini 2.5 Flash TTS Preview',
};

/** 新規設定時の初期値。保存済みの ttsModel は normalizeSettings で保持される。 */
export const DEFAULT_GEMINI_TTS_MODEL: GeminiTtsModel = 'gemini-3.8-flash-tts';

export type GeminiTtsModelCapabilities = {
  /**
   * true: 入力テキストを一字一句そのまま読み上げるモデル。話し方の指示は本文に連結せず、
   * パートの speech_metadata.style で渡す。false: 指示を本文の前に連結する従来方式。
   */
  styleViaSpeechMetadata: boolean;
  /**
   * 非ストリーミング応答の既定の音声形式('wav' = RIFF ヘッダ付き / 'pcm' = ヘッダなし 16bit PCM)。
   * 参考情報。デコードはモデル名ではなく応答データの先頭(RIFF)で判定する。
   */
  defaultAudioFormat: 'wav' | 'pcm';
};

const GEMINI_TTS_MODEL_CAPABILITIES: Record<GeminiTtsModel, GeminiTtsModelCapabilities> = {
  'gemini-3.8-flash-tts': { styleViaSpeechMetadata: true, defaultAudioFormat: 'wav' },
  'gemini-3.8-flash-lite-tts': { styleViaSpeechMetadata: true, defaultAudioFormat: 'wav' },
  'gemini-3.1-flash-tts-preview': { styleViaSpeechMetadata: false, defaultAudioFormat: 'pcm' },
  'gemini-2.5-pro-preview-tts': { styleViaSpeechMetadata: false, defaultAudioFormat: 'pcm' },
  'gemini-2.5-flash-preview-tts': { styleViaSpeechMetadata: false, defaultAudioFormat: 'pcm' },
};

const TEXT_COMPLETION_MODEL_SET = new Set<string>(TEXT_COMPLETION_MODELS);
const OPENAI_TEXT_COMPLETION_MODEL_SET = new Set<string>(OPENAI_TEXT_COMPLETION_MODELS);
const GEMINI_TEXT_COMPLETION_MODEL_SET = new Set<string>(GEMINI_TEXT_COMPLETION_MODELS);
const ANTHROPIC_TEXT_COMPLETION_MODEL_SET = new Set<string>(ANTHROPIC_TEXT_COMPLETION_MODELS);
const OPENAI_REASONING_EFFORT_SET = new Set<string>(OPENAI_REASONING_EFFORTS);
const GEMINI_THINKING_LEVEL_SET = new Set<string>(GEMINI_THINKING_LEVELS);
const CLAUDE_EFFORT_SET = new Set<string>(CLAUDE_EFFORTS);
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

export function isAnthropicTextCompletionModel(
  value: unknown
): value is AnthropicTextCompletionModel {
  return typeof value === 'string' && ANTHROPIC_TEXT_COMPLETION_MODEL_SET.has(value);
}

export function getTextCompletionModelProvider(model: TextCompletionModel): TextCompletionProvider {
  if (isOpenAITextCompletionModel(model)) return 'openai';
  if (isAnthropicTextCompletionModel(model)) return 'anthropic';
  return 'gemini';
}

export function isOpenAIReasoningEffort(value: unknown): value is OpenAIReasoningEffort {
  return typeof value === 'string' && OPENAI_REASONING_EFFORT_SET.has(value);
}

export function isGeminiThinkingLevel(value: unknown): value is GeminiThinkingLevel {
  return typeof value === 'string' && GEMINI_THINKING_LEVEL_SET.has(value);
}

export function isClaudeEffort(value: unknown): value is ClaudeEffort {
  return typeof value === 'string' && CLAUDE_EFFORT_SET.has(value);
}

const OPENAI_REASONING_EFFORTS_BY_MODEL: Record<
  OpenAITextCompletionModel,
  readonly SelectableOpenAIReasoningEffort[]
> = {
  'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-sol': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-terra': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.5': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.4': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.2': ['none', 'low', 'medium', 'high', 'xhigh'],
};

const OPENAI_DEFAULT_REASONING_EFFORT_BY_MODEL: Record<
  OpenAITextCompletionModel,
  SelectableOpenAIReasoningEffort
> = {
  'gpt-6-astra': 'medium',
  'gpt-5.6-sol': 'medium',
  'gpt-5.6-terra': 'medium',
  'gpt-5.6-luna': 'medium',
  'gpt-5.5': 'none',
  'gpt-5.4': 'none',
  'gpt-5.2': 'none',
};

const OPENAI_TEMPERATURE_SUPPORTED_EFFORTS_BY_MODEL: Record<
  OpenAITextCompletionModel,
  readonly SelectableOpenAIReasoningEffort[]
> = {
  'gpt-6-astra': [],
  'gpt-5.6-sol': [],
  'gpt-5.6-terra': [],
  'gpt-5.6-luna': [],
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

export function getCommonSupportedOpenAIReasoningEfforts(
  models: readonly OpenAITextCompletionModel[]
): readonly SelectableOpenAIReasoningEffort[] {
  if (models.length === 0) return [];
  const [firstModel, ...otherModels] = models;
  return getSupportedOpenAIReasoningEfforts(firstModel).filter((effort) =>
    otherModels.every((model) => getSupportedOpenAIReasoningEfforts(model).includes(effort))
  );
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
  return OPENAI_DEFAULT_REASONING_EFFORT_BY_MODEL[model];
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

const CLAUDE_EFFORTS_BY_MODEL: Record<
  AnthropicTextCompletionModel,
  readonly SelectableClaudeEffort[]
> = {
  'claude-opus-5-5': ['low', 'medium', 'high', 'xhigh', 'max'],
};

// API 側の既定値は medium だが、脚本品質を重視してアプリの既定値は high にする
const CLAUDE_DEFAULT_EFFORT_BY_MODEL: Record<AnthropicTextCompletionModel, SelectableClaudeEffort> =
  {
    'claude-opus-5-5': 'high',
  };

export function getSupportedClaudeEfforts(
  model: AnthropicTextCompletionModel
): readonly SelectableClaudeEffort[] {
  return CLAUDE_EFFORTS_BY_MODEL[model];
}

export function getDefaultClaudeEffort(
  model: AnthropicTextCompletionModel
): SelectableClaudeEffort {
  return CLAUDE_DEFAULT_EFFORT_BY_MODEL[model];
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

export function getGeminiTtsModelCapabilities(model: GeminiTtsModel): GeminiTtsModelCapabilities {
  return GEMINI_TTS_MODEL_CAPABILITIES[model];
}
