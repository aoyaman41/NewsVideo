import { readingEntrySchema, type ReadingEntry } from '../project/narration';
import { z } from 'zod';
import {
  CLOSING_LINE_MODES,
  SOURCE_DISPLAY_MODES,
  type ClosingLineMode,
  type SourceDisplayMode,
} from '../project/presentationProfile';
import {
  DEFAULT_IMAGE_STYLE_PRESET,
  IMAGE_STYLE_PRESETS,
  type ImageStylePreset,
} from '../project/imageStylePresets';
import {
  TTS_NARRATION_STYLE_PRESETS,
  type TtsNarrationStylePreset,
} from '../project/ttsNarrationStyles';
import { DEFAULT_PURPOSE_ID, PURPOSE_IDS, type PurposeId } from '../project/purposes';
import { VIDEO_BITRATE_MODES, isVideoBitrate, type VideoBitrateMode } from '../project/videoFormat';
import {
  ANTHROPIC_TEXT_COMPLETION_MODEL,
  CLAUDE_EFFORTS,
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
  OPENAI_TEXT_COMPLETION_MODEL,
  TEXT_COMPLETION_MODELS,
  getDefaultClaudeEffort,
  getDefaultGeminiThinkingLevel,
  getDefaultOpenAIReasoningEffort,
  getCommonSupportedOpenAIReasoningEfforts,
  getSupportedClaudeEfforts,
  isAnthropicTextCompletionModel,
  isClaudeEffort,
  isGeminiThinkingLevel,
  isGeminiTtsModel,
  isImageModel,
  isImageResolution,
  isOpenAIReasoningEffort,
  isOpenAITextCompletionModel,
  isTextCompletionModel,
  normalizeImageModelId,
  type AnthropicTextCompletionModel,
  type ClaudeEffort,
  type GeminiThinkingLevel,
  type GeminiTtsModel,
  type ImageModel,
  type ImageResolution,
  type OpenAIReasoningEffort,
  type SelectableClaudeEffort,
  type SelectableOpenAIReasoningEffort,
  type OpenAITextCompletionModel,
  type TextCompletionModel,
} from '../constants/models';

export const TTS_ENGINES = ['google_tts', 'gemini_tts', 'macos_tts'] as const;
export type TTSEngine = (typeof TTS_ENGINES)[number];

/** 自動生成の進め方。automatic は最後まで自動、review は台本と素材ができたところで止めて確認する */
export const GENERATION_MODES = ['automatic', 'review'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

/**
 * 「新しい動画」の既定値(設定画面の「新しい動画」区分)。新しく作る動画にだけ使い、作成済みの動画は変えない。
 * 設定保存時に全プロジェクトへ反映する仕組み(electron/ipc/settings.ts の generationKeys)には入れない。
 * 用途の性格を決める項目(画面の縦横・長さ・シーン数)は用途で決まるので、ここには持たない
 * (shared/project/purposes.ts の applyNewProjectDefaults で用途の値に重ねる)。
 * null と空欄は「用途に合わせる」(用途ごとに既定値が違う項目だけ)。
 */
export type NewProjectDefaults = {
  /** 作成画面で最初に選ばれている用途 */
  purpose: PurposeId;
  /** 画像の雰囲気と補足 */
  imageStylePreset: ImageStylePreset;
  styleReferenceNote: string;
  /** 話し方と補足。null は用途に合わせる(ニュース調・落ち着いた解説・カジュアル) */
  ttsNarrationStylePreset: TtsNarrationStylePreset | null;
  ttsNarrationStyleNote: string;
  /** 締めのひとこと */
  closingLineMode: ClosingLineMode;
  closingLineText: string;
  /** 締めの画面。見出しが空欄なら用途に合わせる */
  closingCardEnabled: boolean;
  closingCardHeadline: string;
  closingCardCtaText: string;
  /** 出典の表示。null は用途に合わせる(ショートは表示しない) */
  sourceDisplayMode: SourceDisplayMode | null;
  sourceDisplayText: string;
};

/** 既定値。このままなら、新しい動画は用途の既定値どおりに始まる(M5 以前と同じ) */
export const DEFAULT_NEW_PROJECT_DEFAULTS: NewProjectDefaults = {
  purpose: DEFAULT_PURPOSE_ID,
  imageStylePreset: DEFAULT_IMAGE_STYLE_PRESET,
  styleReferenceNote: '',
  ttsNarrationStylePreset: null,
  ttsNarrationStyleNote: '',
  closingLineMode: 'preset',
  closingLineText: '',
  closingCardEnabled: true,
  closingCardHeadline: '',
  closingCardCtaText: '',
  sourceDisplayMode: null,
  sourceDisplayText: '',
};

const TEXT_LIMIT = 500;

/** 保存するときの検証。項目ごとに省略でき(部分的な更新)、不正な値は拒否する */
export const newProjectDefaultsUpdateSchema = z
  .object({
    purpose: z.enum(PURPOSE_IDS),
    imageStylePreset: z.enum(IMAGE_STYLE_PRESETS),
    styleReferenceNote: z.string().max(TEXT_LIMIT),
    ttsNarrationStylePreset: z.enum(TTS_NARRATION_STYLE_PRESETS).nullable(),
    ttsNarrationStyleNote: z.string().max(TEXT_LIMIT),
    closingLineMode: z.enum(CLOSING_LINE_MODES),
    closingLineText: z.string().max(TEXT_LIMIT),
    closingCardEnabled: z.boolean(),
    closingCardHeadline: z.string().max(TEXT_LIMIT),
    closingCardCtaText: z.string().max(TEXT_LIMIT),
    sourceDisplayMode: z.enum(SOURCE_DISPLAY_MODES).nullable(),
    sourceDisplayText: z.string().max(TEXT_LIMIT),
  })
  .partial()
  .strip();

/**
 * 保存済みの値を読むときの正規化。項目ごとに検証し、ない項目・不正な項目は既定値で補う
 * (1 項目が壊れていても、ほかの項目は残す)。
 */
export function normalizeNewProjectDefaults(input: unknown): NewProjectDefaults {
  const raw =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const shape = newProjectDefaultsUpdateSchema.shape;
  const result = { ...DEFAULT_NEW_PROJECT_DEFAULTS } as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_NEW_PROJECT_DEFAULTS) as (keyof NewProjectDefaults)[]) {
    if (!(key in raw)) continue;
    const parsed = shape[key].safeParse(raw[key]);
    if (parsed.success && parsed.data !== undefined) {
      result[key] = typeof parsed.data === 'string' ? parsed.data.trim() : parsed.data;
    }
  }
  return result as NewProjectDefaults;
}

/** 為替レート(1 ドルあたりの円)の既定値と、受け付ける範囲 */
export const DEFAULT_JPY_PER_USD = 150;
const JPY_PER_USD_RANGE = { min: 1, max: 10000 } as const;

export function isValidJpyPerUsd(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= JPY_PER_USD_RANGE.min &&
    value <= JPY_PER_USD_RANGE.max
  );
}

/** 以前の既定値(8M 固定)。ビットレートの決め方が保存されていない設定で、この値は「自動」とみなす */
const LEGACY_DEFAULT_VIDEO_BITRATE = '8M';

export type AppSettings = {
  readingDictionary: ReadingEntry[];
  /**
   * 旧設定(全プロバイダ共通の同時実行数)。保存済みの settings.json を読めるよう項目だけ残す。
   * 同時実行数はプロバイダと用途ごとの既定値(electron/utils/generationPolicy.ts)で決まり、この値は使わない
   */
  generationConcurrency: number;
  /**
   * 「おまかせで作る」の進め方の既定値(設定画面の「新しい動画」で変える)。
   * 記事画面での変更はその回だけに効き、この値は変えない
   */
  generationMode: GenerationMode;
  /** 「おまかせで作る」の 1 回の予算の上限の既定値(USD)。null は上限なし。変える場所は進め方と同じ */
  generationBudgetUsd: number | null;
  ttsEngine: TTSEngine;
  ttsModel: GeminiTtsModel;
  ttsVoice: string;
  ttsSpeakingRate: number;
  ttsPitch: number;
  scriptTextModel: TextCompletionModel;
  imagePromptTextModel: TextCompletionModel;
  openaiReasoningEffort: OpenAIReasoningEffort;
  geminiThinkingLevel: GeminiThinkingLevel;
  /** 台本の生成と台本へのコメント反映に使う Claude の effort */
  claudeEffort: ClaudeEffort;
  /** 画像プロンプトの抽出と画像プロンプトへのコメント反映に使う Claude の effort */
  claudeImagePromptEffort: ClaudeEffort;
  imageModel: ImageModel;
  imageResolution: ImageResolution;
  /**
   * 旧設定「新しいプロジェクトの縦横比」。用途を選んで作る動画では用途の縦横を使うため、
   * 用途を指定しない作成(旧形式の呼び出し)のときだけ使う。保存済みの値を読めるよう項目は残す
   */
  defaultAspectRatio: '16:9' | '1:1' | '9:16';
  videoResolution: '1920x1080' | '1280x720' | '3840x2160';
  videoFps: number;
  /**
   * 映像のビットレートの決め方。auto は解像度と fps から決める(YouTube の推奨値)。
   * manual は videoBitrate を使う。項目がない以前の settings.json は normalizeSettings で補う
   */
  videoBitrateMode: VideoBitrateMode;
  /** 指定するときの映像のビットレート(auto のときは使わない。「指定する」に切り替えたときの初期値) */
  videoBitrate: string;
  audioBitrate: string;
  videoPartLeadInSec: number;
  openingVideoPath: string;
  endingVideoPath: string;
  defaultProjectDir: string;
  /** 金額の表示に使う為替レート(1 ドルあたりの円) */
  jpyPerUsd: number;
  /** 新しい動画の既定値 */
  newProjectDefaults: NewProjectDefaults;
  cost?: unknown;
};

export const DEFAULT_SETTINGS: AppSettings = {
  readingDictionary: [],
  generationConcurrency: 2,
  // 既定は全自動(ユーザー決定 2026-09-26)。予算は従来の記事画面の初期値(5 USD)を引き継ぐ
  generationMode: 'automatic',
  generationBudgetUsd: 5,
  ttsEngine: 'gemini_tts',
  ttsModel: DEFAULT_GEMINI_TTS_MODEL,
  ttsVoice: 'Charon',
  ttsSpeakingRate: 1.0,
  ttsPitch: 0,
  scriptTextModel: DEFAULT_SCRIPT_TEXT_MODEL,
  imagePromptTextModel: DEFAULT_IMAGE_PROMPT_TEXT_MODEL,
  openaiReasoningEffort: getDefaultOpenAIReasoningEffort('gpt-5.2'),
  geminiThinkingLevel: getDefaultGeminiThinkingLevel('gemini-3.1-pro'),
  claudeEffort: getDefaultClaudeEffort(ANTHROPIC_TEXT_COMPLETION_MODEL),
  claudeImagePromptEffort: getDefaultClaudeEffort(ANTHROPIC_TEXT_COMPLETION_MODEL),
  imageModel: DEFAULT_IMAGE_MODEL,
  imageResolution: DEFAULT_IMAGE_RESOLUTION,
  defaultAspectRatio: '16:9',
  videoResolution: '1920x1080',
  videoFps: 30,
  videoBitrateMode: 'auto',
  videoBitrate: LEGACY_DEFAULT_VIDEO_BITRATE,
  audioBitrate: '192k',
  videoPartLeadInSec: 0.3,
  openingVideoPath: '',
  endingVideoPath: '',
  defaultProjectDir: '',
  jpyPerUsd: DEFAULT_JPY_PER_USD,
  newProjectDefaults: DEFAULT_NEW_PROJECT_DEFAULTS,
};

export const settingsUpdateSchema = z
  .object({
    readingDictionary: z.array(readingEntrySchema).max(500).optional(),
    generationConcurrency: z.number().int().min(1).max(4).optional(),
    generationMode: z.enum(GENERATION_MODES).optional(),
    generationBudgetUsd: z.number().finite().nonnegative().nullable().optional(),
    ttsEngine: z.enum(TTS_ENGINES).optional(),
    ttsModel: z.enum(GEMINI_TTS_MODELS).optional(),
    ttsVoice: z.string().optional(),
    ttsSpeakingRate: z.number().finite().optional(),
    ttsPitch: z.number().finite().optional(),
    scriptTextModel: z.enum(TEXT_COMPLETION_MODELS).optional(),
    imagePromptTextModel: z.enum(TEXT_COMPLETION_MODELS).optional(),
    openaiReasoningEffort: z.enum(OPENAI_REASONING_EFFORTS).optional(),
    geminiThinkingLevel: z.enum(GEMINI_THINKING_LEVELS).optional(),
    claudeEffort: z.enum(CLAUDE_EFFORTS).optional(),
    claudeImagePromptEffort: z.enum(CLAUDE_EFFORTS).optional(),
    imageModel: z.preprocess(normalizeImageModelId, z.enum(IMAGE_MODELS)).optional(),
    imageResolution: z.enum(IMAGE_RESOLUTIONS).optional(),
    defaultAspectRatio: z.enum(['16:9', '1:1', '9:16']).optional(),
    videoResolution: z.enum(['1920x1080', '1280x720', '3840x2160']).optional(),
    videoFps: z.number().finite().optional(),
    videoBitrateMode: z.enum(VIDEO_BITRATE_MODES).optional(),
    videoBitrate: z.string().optional(),
    audioBitrate: z.string().optional(),
    videoPartLeadInSec: z.number().finite().optional(),
    openingVideoPath: z.string().optional(),
    endingVideoPath: z.string().optional(),
    defaultProjectDir: z.string().optional(),
    jpyPerUsd: z.number().finite().min(JPY_PER_USD_RANGE.min).max(JPY_PER_USD_RANGE.max).optional(),
    newProjectDefaults: newProjectDefaultsUpdateSchema.optional(),
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
  // 既定のテキストモデルが OpenAI でないときは、旧来の既定値(gpt-5.2)の推論強度を基準にする
  return OPENAI_TEXT_COMPLETION_MODEL;
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

function resolveSettingsAnthropicModel(model: TextCompletionModel): AnthropicTextCompletionModel {
  return isAnthropicTextCompletionModel(model) ? model : ANTHROPIC_TEXT_COMPLETION_MODEL;
}

function normalizeClaudeEffort(
  value: unknown,
  model: AnthropicTextCompletionModel
): SelectableClaudeEffort {
  if (
    isClaudeEffort(value) &&
    value !== 'default' &&
    getSupportedClaudeEfforts(model).includes(value as SelectableClaudeEffort)
  ) {
    return value as SelectableClaudeEffort;
  }
  return getDefaultClaudeEffort(model);
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
  if (!GENERATION_MODES.includes(merged.generationMode)) {
    merged.generationMode = DEFAULT_SETTINGS.generationMode;
  }
  if (
    merged.generationBudgetUsd !== null &&
    !(
      typeof merged.generationBudgetUsd === 'number' &&
      Number.isFinite(merged.generationBudgetUsd) &&
      merged.generationBudgetUsd >= 0
    )
  ) {
    merged.generationBudgetUsd = DEFAULT_SETTINGS.generationBudgetUsd;
  }

  if (!isValidJpyPerUsd(merged.jpyPerUsd)) merged.jpyPerUsd = DEFAULT_JPY_PER_USD;
  merged.newProjectDefaults = normalizeNewProjectDefaults(raw.newProjectDefaults);

  // 映像のビットレートの決め方。項目がない以前の settings.json では、以前の既定値(8M)と書き方に合わない値は
  // 「自動」、それ以外(利用者が指定した値)は「指定する」とみなす。以前の版は既定値もすべて保存していたため、
  // 8M は利用者が選んだ値と区別できない(1080p30 なら自動でも 8M で同じ)
  if (!(VIDEO_BITRATE_MODES as readonly unknown[]).includes(raw.videoBitrateMode)) {
    merged.videoBitrateMode =
      isVideoBitrate(merged.videoBitrate) && merged.videoBitrate !== LEGACY_DEFAULT_VIDEO_BITRATE
        ? 'manual'
        : 'auto';
  }
  if (typeof merged.videoBitrate !== 'string' || !merged.videoBitrate.trim()) {
    merged.videoBitrate = LEGACY_DEFAULT_VIDEO_BITRATE;
  }

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

  // 提供終了した preview 版の ID は GA 版へ読み替える(未知の値だけ既定値に戻す)
  merged.imageModel = normalizeImageModelId(merged.imageModel);
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
  // Claude の effort は用途別(台本 / 画像プロンプト)。項目がない既存の settings.json は既定値で補う
  merged.claudeEffort = normalizeClaudeEffort(
    merged.claudeEffort,
    resolveSettingsAnthropicModel(merged.scriptTextModel)
  );
  merged.claudeImagePromptEffort = normalizeClaudeEffort(
    merged.claudeImagePromptEffort,
    resolveSettingsAnthropicModel(merged.imagePromptTextModel)
  );

  return merged;
}
