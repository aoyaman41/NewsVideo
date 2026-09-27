import { scriptRequestSchema } from '../../shared/project/generationRequests';
import {
  retryTransient,
  limitedAnthropicFetch,
  limitedOpenAIFetch,
  withProviderSlot,
} from '../utils/generationPolicy';
import { generationSettings, jobOperationContext } from '../utils/generationContext';
import { registerOperation } from './operations';
import { app, safeStorage } from 'electron';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import OpenAI from 'openai';
import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/core/error';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { ChatCompletionContentPartText } from 'openai/resources/chat/completions';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import Anthropic, { type AutoParseableOutputFormat } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import {
  DEFAULT_IMAGE_PROMPT_TEXT_MODEL,
  DEFAULT_SCRIPT_TEXT_MODEL,
  GEMINI_TEXT_COMPLETION_MODEL,
  getDefaultClaudeEffort,
  getDefaultGeminiThinkingLevel,
  getDefaultOpenAIReasoningEffort,
  getSupportedClaudeEfforts,
  getSupportedGeminiThinkingLevels,
  getSupportedOpenAIReasoningEfforts,
  isAnthropicTextCompletionModel,
  isOpenAITextCompletionModel,
  isTextCompletionModel,
  isGeminiTextCompletionModel,
  supportsOpenAIPromptCacheBreakpoint,
  supportsOpenAITemperature,
  type AnthropicTextCompletionModel,
  type ClaudeEffort,
  type GeminiThinkingLevel,
  type OpenAITextCompletionModel,
  type OpenAIReasoningEffort,
  type SelectableClaudeEffort,
  type TextCompletionModel,
} from '../../shared/constants/models';
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  getImageAspectRatioLabel,
  getImageLayoutVariant,
  getImageStylePresetConfig,
  isImageAspectRatio,
  type ImageAspectRatio,
  type ImageStylePreset,
  type ImageStylePresetConfig,
} from '../../shared/project/imageStylePresets';
import { IMAGE_TEXT_SECTION_LABEL, formatImageTextSection } from '../../shared/project/imageText';
import { PRESENTATION_PROFILE_PRESET_CLOSING_LINES } from '../../shared/project/presentationProfile';
import { narrationCharsFor } from '../../shared/project/narration';
import { DEFAULT_SCENE_COUNT, DEFAULT_SECONDS_PER_PART } from '../../shared/project/purposes';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../shared/settings/appSettings';
import { sanitizeImagePromptForRendering } from '../../shared/utils/imagePromptSanitizer';

// シークレットファイルのパス
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

type TextGenerationScope = 'script' | 'image_prompt';
const GEMINI_3_PRO_API_MODEL_ID = 'gemini-3.1-pro-preview';

type TextGenerationConfig = {
  model: TextCompletionModel;
  openaiReasoningEffort: OpenAIReasoningEffort;
  geminiThinkingLevel: GeminiThinkingLevel;
  /** 用途(台本 / 画像プロンプト)に応じた Claude の effort */
  claudeEffort: ClaudeEffort;
};

// APIキーを読み込み
async function readApiKey(service: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    const secretsPath = getSecretsPath();
    const encryptedData = await fs.readFile(secretsPath);
    const decrypted = safeStorage.decryptString(encryptedData);
    const secrets = JSON.parse(decrypted);
    return secrets[service] || null;
  } catch {
    return null;
  }
}
const withRetry = retryTransient;

type OpenAIUsageSummary = {
  provider?: 'openai' | 'gemini' | 'anthropic';
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  requestCount?: number;
  model?: string;
};

function mapOpenAIUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: {
          cached_tokens?: number;
          cache_write_tokens?: number;
        };
        completion_tokens_details?: { reasoning_tokens?: number };
      }
    | undefined,
  model?: string
): OpenAIUsageSummary | null {
  if (!usage && !model) return null;
  return {
    provider: 'openai',
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens,
    cacheWriteTokens: usage?.prompt_tokens_details?.cache_write_tokens,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
    totalTokens: usage?.total_tokens,
    requestCount: 1,
    model,
  };
}

// thinking のトークン(thoughtsTokenCount)は出力単価で課金されるため、出力トークンに含めて記録する
function mapGeminiUsage(
  usage:
    | {
        promptTokenCount?: number;
        responseTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        prompt_token_count?: number;
        candidates_token_count?: number;
        thoughts_token_count?: number;
        total_token_count?: number;
      }
    | undefined,
  model?: string
): OpenAIUsageSummary | null {
  if (!usage && !model) return null;
  const responseTokens =
    usage?.responseTokenCount ??
    usage?.candidatesTokenCount ??
    usage?.completionTokens ??
    usage?.candidates_token_count;
  const thoughtsTokens = usage?.thoughtsTokenCount ?? usage?.thoughts_token_count;
  const outputTokens =
    responseTokens === undefined && thoughtsTokens === undefined
      ? undefined
      : (responseTokens ?? 0) + (thoughtsTokens ?? 0);
  return {
    provider: 'gemini',
    inputTokens: usage?.promptTokenCount ?? usage?.promptTokens ?? usage?.prompt_token_count,
    outputTokens,
    ...(thoughtsTokens !== undefined ? { reasoningTokens: thoughtsTokens } : {}),
    totalTokens: usage?.totalTokenCount ?? usage?.totalTokens ?? usage?.total_token_count,
    requestCount: 1,
    model,
  };
}

// OpenAI の規約に合わせ、inputTokens はキャッシュ読み取り・書き込みを含む合計にする
function mapAnthropicUsage(usage: Anthropic.Messages.Usage, model: string): OpenAIUsageSummary {
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const inputTokens = usage.input_tokens + cacheReadTokens + cacheWriteTokens;
  return {
    provider: 'anthropic',
    inputTokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: usage.output_tokens_details?.thinking_tokens,
    totalTokens: inputTokens + usage.output_tokens,
    requestCount: 1,
    model,
  };
}

function aggregateUsageSummaries(
  usages: Array<OpenAIUsageSummary | null>
): OpenAIUsageSummary | null {
  const valid = usages.filter((usage): usage is OpenAIUsageSummary => usage !== null);
  if (valid.length === 0) return null;

  const first = valid[0];
  const sameProvider = valid.every((usage) => usage.provider === first.provider);
  const sameModel = valid.every((usage) => usage.model === first.model);

  const sum = (picker: (usage: OpenAIUsageSummary) => number | undefined): number | undefined => {
    const total = valid.reduce((acc, usage) => acc + (picker(usage) ?? 0), 0);
    return total > 0 ? total : undefined;
  };

  return {
    provider: sameProvider ? first.provider : undefined,
    model: sameModel ? first.model : undefined,
    inputTokens: sum((usage) => usage.inputTokens),
    outputTokens: sum((usage) => usage.outputTokens),
    cachedInputTokens: sum((usage) => usage.cachedInputTokens),
    cacheWriteTokens: sum((usage) => usage.cacheWriteTokens),
    reasoningTokens: sum((usage) => usage.reasoningTokens),
    totalTokens: sum((usage) => usage.totalTokens),
    requestCount: sum((usage) => usage.requestCount),
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Gemini のテキスト生成。Gemini 3 は temperature を既定値(1.0)のまま使うよう公式が強く推奨しているため送らない。
 * responseJsonSchema を渡すと構造化出力(application/json)にする。
 */
async function generateGeminiTextContent(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseJsonSchema?: unknown;
  thinkingLevel: GeminiThinkingLevel;
}): Promise<{ text: string; usage: OpenAIUsageSummary | null }> {
  const apiKey = await readApiKey('google_ai');
  if (!apiKey) {
    throw new Error(
      'Google AI APIキーが設定されていません。設定画面から（Google AI Studio / Generative Language）用のAPIキーを入力してください。'
    );
  }
  const ai = new GoogleGenAI({ apiKey });
  const thinkingLevel =
    params.thinkingLevel === 'high'
      ? ThinkingLevel.HIGH
      : params.thinkingLevel === 'medium'
        ? ThinkingLevel.MEDIUM
        : params.thinkingLevel === 'low'
          ? ThinkingLevel.LOW
          : null;
  const response = await withRetry(async () => {
    return ai.models.generateContent({
      model: params.model,
      contents: params.userPrompt,
      config: {
        systemInstruction: params.systemPrompt,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        ...(params.responseJsonSchema
          ? { responseMimeType: 'application/json', responseJsonSchema: params.responseJsonSchema }
          : {}),
      },
    });
  });

  const fallbackText = (response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();
  const text = normalizeString(response.text) || fallbackText;
  if (!text) {
    throw new Error('AIからの応答が空でした');
  }

  return {
    text,
    usage: mapGeminiUsage(response.usageMetadata, params.model),
  };
}

// responseJsonSchema が受け付けるキーワードだけを残す(minLength・exclusiveMinimum・$schema などは落とす)
const GEMINI_JSON_SCHEMA_KEYWORDS = new Set([
  '$id',
  '$defs',
  '$ref',
  '$anchor',
  'type',
  'format',
  'title',
  'description',
  'enum',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'properties',
  'additionalProperties',
  'required',
]);

function pruneJsonSchemaForGemini(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(pruneJsonSchemaForGemini);
  if (!node || typeof node !== 'object') return node;
  const pruned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!GEMINI_JSON_SCHEMA_KEYWORDS.has(key)) continue;
    if ((key === 'properties' || key === '$defs') && value && typeof value === 'object') {
      // properties / $defs のキーはフィールド名なので、値のスキーマだけを処理する
      pruned[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, schema]) => [
          name,
          pruneJsonSchemaForGemini(schema),
        ])
      );
    } else if (key === 'required' || key === 'enum') {
      pruned[key] = value;
    } else {
      pruned[key] = pruneJsonSchemaForGemini(value);
    }
  }
  return pruned;
}

function toGeminiJsonSchema(schema: z.ZodType): unknown {
  return pruneJsonSchemaForGemini(z.toJSONSchema(schema));
}

function resolveGeminiApiModel(selectedModel: TextCompletionModel): string {
  if (selectedModel === GEMINI_TEXT_COMPLETION_MODEL) {
    return GEMINI_3_PRO_API_MODEL_ID;
  }
  return selectedModel;
}

// 脚本生成はストリーミングで受け取り、thinking を含めて十分な出力枠を確保する
const CLAUDE_STREAMING_MAX_TOKENS = 64_000;
const CLAUDE_MAX_TOKENS = 16_000;

function resolveClaudeEffort(value: ClaudeEffort): SelectableClaudeEffort | null {
  return value === 'default' ? null : value;
}

function assertClaudeMessageCompleted(message: Anthropic.Messages.Message): void {
  if (message.stop_reason === 'refusal') {
    // サーバー側のフォールバックは使わず、拒否はそのままエラーとして表示する
    const category = message.stop_details?.category ?? '不明';
    throw new Error(
      `Claudeが安全上の理由で生成を拒否しました(カテゴリ: ${category})。記事内容を確認するか、別のモデルで再実行してください。`
    );
  }
  if (
    message.stop_reason === 'max_tokens' ||
    message.stop_reason === 'model_context_window_exceeded'
  ) {
    throw new Error(
      'Claudeの出力が上限で途中終了しました。入力を短くするか、思考の深さを下げて再試行してください。'
    );
  }
}

/**
 * Claude のテキスト生成。thinking は常にオンのため `thinking` と sampling パラメータは送らず、
 * 思考の深さは output_config.effort だけで指定する。リトライは SDK 標準(maxRetries 2)に任せる。
 */
async function generateClaudeTextContent(params: {
  model: AnthropicTextCompletionModel;
  systemPrompt: string;
  userPrompt: string;
  effort: ClaudeEffort;
  stream?: boolean;
  /**
   * リクエスト間で共通の先頭部分(記事本文など)。user の最初のブロックに置いて cache_control を付け、
   * system とこのブロックまでをキャッシュする。リクエストごとに変わる内容は userPrompt(2 番目のブロック)に置く
   */
  cachedUserPrefix?: string;
  outputFormat?: Anthropic.Messages.JSONOutputFormat;
}): Promise<{ text: string; usage: OpenAIUsageSummary }> {
  const apiKey = await readApiKey('anthropic');
  if (!apiKey) {
    throw new Error(
      'Anthropic APIキーが設定されていません。設定画面からAPIキーを入力してください。'
    );
  }

  // 自動生成ジョブが応答の開始を待っている場合(同じ記事への画像プロンプトで、1 本目がキャッシュを書き込む
  // まで残りを送らないため)は、ストリーミングで受け取り、最初のイベントで開始を知らせる
  const onResponseStart = jobOperationContext.getStore()?.onResponseStart;
  const streaming = Boolean(params.stream || onResponseStart);
  // 環境変数の ANTHROPIC_AUTH_TOKEN が混ざらないよう authToken は明示的に無効化する。
  // ストリーミングは応答ヘッダーの受信時点で fetch が返り、fetch 単位の枠では生成中の同時実行数を
  // 制御できないため、通常の fetch を使ってストリーム全体(SDK 内蔵リトライを含む)を 1 つの枠で包む
  const client = new Anthropic({
    apiKey,
    authToken: null,
    ...(streaming ? {} : { fetch: limitedAnthropicFetch }),
  });
  const effort = resolveClaudeEffort(params.effort);
  const outputConfig: Anthropic.Messages.OutputConfig = {
    ...(effort ? { effort } : {}),
    ...(params.outputFormat ? { format: params.outputFormat } : {}),
  };
  const request: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: params.model,
    max_tokens: params.stream ? CLAUDE_STREAMING_MAX_TOKENS : CLAUDE_MAX_TOKENS,
    system: params.systemPrompt,
    messages: [
      {
        role: 'user',
        content: params.cachedUserPrefix
          ? [
              {
                type: 'text',
                text: params.cachedUserPrefix,
                cache_control: { type: 'ephemeral' },
              },
              { type: 'text', text: params.userPrompt },
            ]
          : params.userPrompt,
      },
    ],
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
  };
  const message = streaming
    ? await withProviderSlot('anthropic:text', () => {
        const stream = client.messages.stream(request);
        if (onResponseStart) stream.once('streamEvent', () => onResponseStart());
        return stream.finalMessage();
      })
    : await client.messages.create(request);

  assertClaudeMessageCompleted(message);
  const text = message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) {
    throw new Error('AIからの応答が空でした');
  }

  return { text, usage: mapAnthropicUsage(message.usage, message.model) };
}

// SDK の自動パース(messages.parse / stream の parsed_output)は stop_reason を確認する前に
// 途切れた JSON で例外を投げるため、リクエストにはスキーマだけを渡し、確認後に同じ zod で検証する
function toClaudeOutputFormat<T>(
  structuredOutput: AutoParseableOutputFormat<T>
): Anthropic.Messages.JSONOutputFormat {
  return { type: structuredOutput.type, schema: structuredOutput.schema };
}

function parseClaudeStructuredOutput<T>(
  structuredOutput: AutoParseableOutputFormat<T>,
  text: string
): T {
  try {
    return structuredOutput.parse(text);
  } catch (error) {
    throw new Error('AIから構造化された応答を取得できませんでした', { cause: error });
  }
}

function resolveOpenAIReasoningEffort(
  value: OpenAIReasoningEffort
): Exclude<OpenAIReasoningEffort, 'default'> | null {
  return value === 'default' ? null : value;
}

async function withLocalizedStructuredOutputErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof LengthFinishReasonError) {
      throw new Error('AIの応答が長さ上限で途中終了しました。入力を短くして再試行してください。', {
        cause: error,
      });
    }
    if (error instanceof ContentFilterFinishReasonError) {
      throw new Error(
        'AIの安全フィルターにより応答を完了できませんでした。入力内容を確認してください。',
        {
          cause: error,
        }
      );
    }
    throw error;
  }
}

function buildOpenAITextGenerationOptions(
  model: OpenAITextCompletionModel,
  reasoningEffort: Exclude<OpenAIReasoningEffort, 'default'> | null,
  temperature: number
): {
  temperature?: number;
  reasoning_effort?: Exclude<OpenAIReasoningEffort, 'default'>;
} {
  return {
    ...(supportsOpenAITemperature(model, reasoningEffort) ? { temperature } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };
}

async function readTextGenerationConfig(scope: TextGenerationScope): Promise<TextGenerationConfig> {
  const fallbackModel =
    scope === 'script' ? DEFAULT_SCRIPT_TEXT_MODEL : DEFAULT_IMAGE_PROMPT_TEXT_MODEL;
  const fallback: TextGenerationConfig = {
    model: fallbackModel,
    openaiReasoningEffort: DEFAULT_SETTINGS.openaiReasoningEffort,
    geminiThinkingLevel: DEFAULT_SETTINGS.geminiThinkingLevel,
    claudeEffort:
      scope === 'script' ? DEFAULT_SETTINGS.claudeEffort : DEFAULT_SETTINGS.claudeImagePromptEffort,
  };
  try {
    const settingsPath = getSettingsPath();
    const content = generationSettings.getStore()
      ? JSON.stringify(generationSettings.getStore())
      : await fs.readFile(settingsPath, 'utf-8');
    const settings = normalizeSettings(JSON.parse(content));
    const selectedModel =
      scope === 'script' ? settings.scriptTextModel : settings.imagePromptTextModel;
    const model = isTextCompletionModel(selectedModel) ? selectedModel : fallback.model;
    const openaiReasoningEffort = isOpenAITextCompletionModel(model)
      ? getSupportedOpenAIReasoningEfforts(model).includes(
          settings.openaiReasoningEffort as Exclude<OpenAIReasoningEffort, 'default'>
        )
        ? settings.openaiReasoningEffort
        : getDefaultOpenAIReasoningEffort(model)
      : settings.openaiReasoningEffort;
    const geminiThinkingLevel = isGeminiTextCompletionModel(model)
      ? getSupportedGeminiThinkingLevels(model).includes(
          settings.geminiThinkingLevel as Exclude<GeminiThinkingLevel, 'default'>
        )
        ? settings.geminiThinkingLevel
        : getDefaultGeminiThinkingLevel(model)
      : settings.geminiThinkingLevel;
    // 台本(コメント反映の台本側を含む)は claudeEffort、画像プロンプトの抽出とコメント反映は
    // claudeImagePromptEffort を使う
    const scopedClaudeEffort =
      scope === 'script' ? settings.claudeEffort : settings.claudeImagePromptEffort;
    const claudeEffort = isAnthropicTextCompletionModel(model)
      ? getSupportedClaudeEfforts(model).includes(scopedClaudeEffort as SelectableClaudeEffort)
        ? scopedClaudeEffort
        : getDefaultClaudeEffort(model)
      : scopedClaudeEffort;
    return {
      model,
      openaiReasoningEffort,
      geminiThinkingLevel,
      claudeEffort,
    };
  } catch {
    // 設定未作成時はデフォルトを利用
  }
  return fallback;
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function parseJsonResponse<T>(text: string): T {
  const payload = extractJsonPayload(text);
  return JSON.parse(payload) as T;
}

function tryParseJsonResponse<T>(text: string): T | null {
  try {
    return parseJsonResponse<T>(text);
  } catch {
    return null;
  }
}

// Gemini の構造化出力(JSON テキスト)を、他社と同じ zod スキーマで検証する
function parseStructuredJson<T>(schema: z.ZodType<T>, text: string): T {
  const result = schema.safeParse(tryParseJsonResponse<unknown>(text));
  if (!result.success) {
    throw new Error('AIから構造化された応答を取得できませんでした', { cause: result.error });
  }
  return result.data;
}

// 記事データの型
interface Article {
  title: string;
  source?: string;
  bodyText: string;
  importedImages: unknown[];
}

// スクリプト生成オプション
interface ScriptOptions {
  targetPartCount?: number;
  tone?: 'formal' | 'casual' | 'news';
  targetDurationPerPartSec?: number;
  closingLine?: string | null;
}

// 生成されたパートの型
interface GeneratedPart {
  id: string;
  index: number;
  title: string;
  summary: string;
  scriptText: string;
  durationEstimateSec: number;
  panelImages: [];
  comments: [];
  createdAt: string;
  updatedAt: string;
  scriptGeneratedAt: string;
  scriptModifiedByUser: boolean;
}

// 異常系ガード用の非常上限（通常は切り詰めない想定）
const MAX_IMAGE_PROMPT_CHARS = 12000;

// 構造化出力のスキーマ。3 社とも同じ zod v4 スキーマから JSON Schema を作る
// (OpenAI: zodResponseFormat、Claude: zodOutputFormat、Gemini: toGeminiJsonSchema)。
// 各項目の意味はプロンプトに JSON の例を書かず、スキーマの description で伝える
const ScriptGenerationPayloadSchema = z.object({
  parts: z
    .array(
      z.object({
        title: z.string().min(1).describe('パートの見出し'),
        summary: z.string().describe('このパートの概要。1〜2文'),
        scriptText: z
          .string()
          .min(1)
          .describe('ナレーション本文。音声合成でそのまま読み上げる文章'),
        durationEstimateSec: z.number().positive().describe('読み上げにかかる推定秒数'),
      })
    )
    .min(1)
    .describe('記事を分割したパート。記事の流れの順に並べる'),
});

type ScriptGenerationPayload = z.infer<typeof ScriptGenerationPayloadSchema>;

const ImagePromptCommentPayloadSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe(`修正後の画像生成プロンプトの全文(${MAX_IMAGE_PROMPT_CHARS}文字以内)`),
});

// スクリプト生成プロンプト(役割の宣言は system 側にだけ書く)
function createScriptGenerationPrompt(article: Article, options: ScriptOptions): string {
  const toneDescription = {
    formal: '丁寧でフォーマルな',
    casual: 'カジュアルで親しみやすい',
    news: 'ニュースキャスターのような客観的で明瞭な',
  };

  const tone = options.tone || 'news';
  const targetPartCount = options.targetPartCount || DEFAULT_SCENE_COUNT;
  const targetDuration = options.targetDurationPerPartSec || DEFAULT_SECONDS_PER_PART;
  const closingLine = typeof options.closingLine === 'string' ? options.closingLine.trim() : '';
  const requirements = [
    `${toneDescription[tone]}トーンで書いてください`,
    `各パートは約${targetDuration}秒（日本語で約${narrationCharsFor(targetDuration)}文字）のナレーションになるようにしてください`,
    '視聴者が理解しやすいよう、論理的な流れで構成してください',
    '重要な情報を漏らさないようにしてください',
    'ナレーションは音声合成でそのまま読み上げます。括弧・記号・英字の略語は使わず、耳で聞いて分かる言葉で書いてください',
    closingLine
      ? `最後のパートの末尾に「${closingLine}」を入れてください`
      : '最後のパートの末尾に定型の締め文を入れないでください',
  ];

  return `以下の記事を、${targetPartCount}個のパートに分割し、各パートのナレーションスクリプトを作成してください。

## 記事情報
タイトル: ${article.title}
${article.source ? `出典: ${article.source}` : ''}

## 記事本文
${article.bodyText}

## 要件
${requirements.map((requirement, index) => `${index + 1}. ${requirement}`).join('\n')}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimTrailingClosingLine(text: string, closingLine: string): string {
  const pattern = new RegExp(
    `(?:\\s|\\u3000|\\n)*${escapeRegExp(closingLine)}[。！!？?\\s\\u3000]*$`
  );
  return text.replace(pattern, '').trimEnd();
}

function normalizeClosingLine(scriptText: string, closingLine: string | null): string {
  const knownClosingLines = Array.from(
    new Set(Object.values(PRESENTATION_PROFILE_PRESET_CLOSING_LINES))
  );
  const baseScript = knownClosingLines.reduce(
    (current, line) => trimTrailingClosingLine(current, line),
    scriptText.trimEnd()
  );

  if (!closingLine) {
    return baseScript;
  }

  const nextClosingLine = closingLine.trim();
  if (!nextClosingLine) {
    return baseScript;
  }

  if (baseScript.endsWith(nextClosingLine)) {
    return baseScript;
  }

  const separator = baseScript.endsWith('\n') || baseScript.length === 0 ? '' : '\n';
  return `${baseScript}${separator}${nextClosingLine}`;
}

// スクリプト生成ハンドラ
registerOperation(
  'ai:generateScript',
  async (
    _,
    article: Article,
    options: ScriptOptions = {}
  ): Promise<{ parts: GeneratedPart[]; usage: OpenAIUsageSummary | null }> => {
    ({ article, options } = scriptRequestSchema.parse({ article, options }));
    const generationConfig = await readTextGenerationConfig('script');
    const selectedModel = generationConfig.model;
    const scriptSystemPrompt =
      'あなたは情報動画のスクリプトライターです。与えられた記事を読みやすいナレーションスクリプトに変換します。';
    const scriptUserPrompt = createScriptGenerationPrompt(article, options);

    let parsed: ScriptGenerationPayload;
    let usage: OpenAIUsageSummary | null = null;

    if (isOpenAITextCompletionModel(selectedModel)) {
      const apiKey = await readApiKey('openai');
      if (!apiKey) {
        throw new Error(
          'OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。'
        );
      }

      const openai = new OpenAI({ apiKey, fetch: limitedOpenAIFetch });
      const reasoningEffort = resolveOpenAIReasoningEffort(generationConfig.openaiReasoningEffort);
      const response = await withLocalizedStructuredOutputErrors(() =>
        openai.chat.completions.parse({
          model: selectedModel,
          messages: [
            { role: 'system', content: scriptSystemPrompt },
            { role: 'user', content: scriptUserPrompt },
          ],
          response_format: zodResponseFormat(
            ScriptGenerationPayloadSchema,
            'script_generation_payload'
          ),
          ...buildOpenAITextGenerationOptions(selectedModel, reasoningEffort, 0.7),
        })
      );

      const choice = response.choices[0];
      if (choice?.message.refusal) {
        throw new Error(`AIが拒否しました: ${choice.message.refusal}`);
      }
      if (!choice?.message.parsed) {
        throw new Error('AIから構造化された応答を取得できませんでした');
      }

      parsed = choice.message.parsed;
      usage = mapOpenAIUsage(response.usage, response.model);
    } else if (isAnthropicTextCompletionModel(selectedModel)) {
      const structuredOutput = zodOutputFormat(ScriptGenerationPayloadSchema);
      const claudeResult = await generateClaudeTextContent({
        model: selectedModel,
        systemPrompt: scriptSystemPrompt,
        userPrompt: scriptUserPrompt,
        effort: generationConfig.claudeEffort,
        stream: true,
        outputFormat: toClaudeOutputFormat(structuredOutput),
      });
      parsed = parseClaudeStructuredOutput(structuredOutput, claudeResult.text);
      usage = claudeResult.usage;
    } else {
      const apiModel = resolveGeminiApiModel(selectedModel);
      const geminiResult = await generateGeminiTextContent({
        model: apiModel,
        systemPrompt: scriptSystemPrompt,
        userPrompt: scriptUserPrompt,
        responseJsonSchema: toGeminiJsonSchema(ScriptGenerationPayloadSchema),
        thinkingLevel: generationConfig.geminiThinkingLevel,
      });
      parsed = parseStructuredJson(ScriptGenerationPayloadSchema, geminiResult.text);
      usage = geminiResult.usage;
    }
    const now = new Date().toISOString();
    const closingLine =
      typeof options.closingLine === 'string' && options.closingLine.trim().length > 0
        ? options.closingLine.trim()
        : null;

    // パートデータを整形
    const parts: GeneratedPart[] = parsed.parts.map(
      (
        part: { title: string; summary: string; scriptText: string; durationEstimateSec: number },
        index: number
      ) => ({
        id: crypto.randomUUID(),
        index,
        title: part.title,
        summary: part.summary,
        scriptText: part.scriptText,
        durationEstimateSec: part.durationEstimateSec || 30,
        panelImages: [],
        comments: [],
        createdAt: now,
        updatedAt: now,
        scriptGeneratedAt: now,
        scriptModifiedByUser: false,
      })
    );
    if (parts.length > 0) {
      const lastIndex = parts.length - 1;
      const last = parts[lastIndex];
      parts[lastIndex] = {
        ...last,
        scriptText: normalizeClosingLine(last.scriptText, closingLine),
      };
    }

    return {
      parts,
      usage,
    };
  }
);

type ImagePrompt = {
  id: string;
  partId: string;
  stylePreset: ImageStylePreset;
  prompt: string;
  negativePrompt: string;
  aspectRatio: ImageAspectRatio;
  visualCopy?: VisualCopy;
  layoutPlan?: LayoutPlan;
  styleReferenceImageIds?: string[];
  version: number;
  createdAt: string;
};

type ImagePromptGenerationOptions = {
  stylePreset?: ImageStylePreset;
  aspectRatio?: ImageAspectRatio;
  styleReferenceImageIds?: string[];
  styleReferenceNote?: string;
};

type VisualCopy = {
  headline: string;
  subhead?: string;
  keyNumber?: string;
  bullets: string[];
};

type LayoutPlan = {
  intent: string;
  composition: string;
  objects: Array<{
    type: string;
    role: string;
    position: string;
    content: string;
    emphasis: string;
  }>;
};

// 画像プロンプトの抽出結果(1 パート分のスライド設計)。画像プロンプトの組み立てで使う項目だけを出力させる
const SlideDesignSchema = z.object({
  visualCopy: z
    .object({
      // 文字数の上限は normalizeVisualCopy の切り詰めと揃える(超えると途中で切れた文字が描かれる)
      headline: z.string().describe('大見出し。短く強い一文。36文字以内'),
      subhead: z.string().describe('見出しを補う一文。80文字以内。不要なら空文字'),
      keyNumber: z
        .string()
        .describe('最も伝えたい数値と単位。28文字以内。記事に数値がなければ空文字'),
      bullets: z.array(z.string()).describe('要点。0〜4件、各項目は44文字以内'),
    })
    .describe('画面に文字として描く文言。画面に出る文字はここに書いたものだけになる'),
  layoutPlan: z
    .object({
      intent: z.string().describe('このスライドで伝える狙い'),
      composition: z.string().describe('全体の構図と読み順'),
      objects: z
        .array(
          z.object({
            type: z
              .string()
              .describe(
                '要素の種類。headline, subhead, keyNumber, bullet, chart, map, icon, diagram, callout など'
              ),
            role: z.string().describe('要素の役割。主情報、補助情報、根拠、導線など'),
            position: z
              .string()
              .describe(
                '配置エリア。upper-left, top-center, center-right, bottom-band, left-column, right-panel などの言葉で示し、割合や座標は使わない'
              ),
            content: z.string().describe('描き方の説明。新しい文字列は入れない'),
            emphasis: z
              .string()
              .describe('強さ。large, medium, small, primary, secondary のいずれか'),
          })
        )
        .describe('画面に置く要素。多くても8件'),
    })
    .describe(
      '画面の設計。画面に出す文字は visualCopy のみ。objects.content は描き方の説明で、新しい文字列は入れない'
    ),
});

type SlideDesign = z.infer<typeof SlideDesignSchema>;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const MAX_EXTRACTED_TEXT_CHARS = 60;

function truncateTextByChars(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trim();
}

const NOISE_LINE_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /\/Users\/|\/home\/|\/var\/|\/tmp\/|\/etc\//i,
  /[A-Z]:\\/,
  /\b(?:INFO|DEBUG|WARN|ERROR|TRACE)\b/i,
];

const NOISE_FILE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'mp4',
  'mov',
  'm4v',
  'json',
  'ts',
  'tsx',
  'js',
  'css',
  'md',
  'pdf',
  'svg',
  'zip',
];

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  const hasPathLike = /[\\/]/.test(trimmed);
  if (hasPathLike) {
    const extPattern = new RegExp(`\\.(${NOISE_FILE_EXTENSIONS.join('|')})\\b`, 'i');
    if (extPattern.test(trimmed)) return true;
  }
  return false;
}

function sanitizeArticleText(text: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => !isNoiseLine(line));
  return filtered.join('\n').trim();
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => truncateTextByChars(normalizeString(item), MAX_EXTRACTED_TEXT_CHARS))
    .filter((item) => item.length > 0);
  return items.slice(0, limit);
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getFirstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function normalizeLooseStringArray(value: unknown, limit: number): string[] {
  if (Array.isArray(value)) {
    return normalizeStringArray(value, limit);
  }
  const single = truncateTextByChars(normalizeString(value), MAX_EXTRACTED_TEXT_CHARS);
  if (!single) return [];
  const split = single
    .split(/[,、\n]/)
    .map((item) => item.trim())
    .map((item) => truncateTextByChars(item, MAX_EXTRACTED_TEXT_CHARS))
    .filter((item) => item.length > 0);
  return split.slice(0, limit);
}

function normalizeVisualCopy(value: unknown): VisualCopy | undefined {
  const record = toObjectRecord(value);
  if (!record) return undefined;

  const headline = truncateTextByChars(
    normalizeString(getFirstDefined(record, ['headline', 'title', 'mainHeadline'])),
    36
  );
  if (!headline) return undefined;

  const subhead = truncateTextByChars(
    normalizeString(getFirstDefined(record, ['subhead', 'subtitle', 'dek'])),
    80
  );
  const keyNumber = truncateTextByChars(
    normalizeString(getFirstDefined(record, ['keyNumber', 'key_number', 'number'])),
    28
  );
  const bullets = normalizeLooseStringArray(
    getFirstDefined(record, ['bullets', 'points', 'callouts']),
    4
  ).map((item) => truncateTextByChars(item, 44));

  return {
    headline,
    ...(subhead ? { subhead } : {}),
    ...(keyNumber ? { keyNumber } : {}),
    bullets,
  };
}

function normalizeLayoutPlan(value: unknown): LayoutPlan | undefined {
  const record = toObjectRecord(value);
  if (!record) return undefined;

  const intent = truncateTextByChars(
    normalizeString(getFirstDefined(record, ['intent', 'goal', 'purpose'])),
    90
  );
  const composition = truncateTextByChars(
    normalizeString(getFirstDefined(record, ['composition', 'layout', 'layoutPolicy'])),
    140
  );
  const rawObjects = getFirstDefined(record, ['objects', 'elements', 'items']);
  const objects = Array.isArray(rawObjects)
    ? rawObjects
        .map((item) => {
          const objectRecord = toObjectRecord(item);
          if (!objectRecord) return null;
          const type = truncateTextByChars(
            normalizeString(getFirstDefined(objectRecord, ['type', 'elementType'])),
            32
          );
          const role = truncateTextByChars(
            normalizeString(getFirstDefined(objectRecord, ['role', 'purpose'])),
            42
          );
          const position = truncateTextByChars(
            normalizeString(getFirstDefined(objectRecord, ['position', 'area', 'slot'])),
            42
          );
          const content = truncateTextByChars(
            normalizeString(getFirstDefined(objectRecord, ['content', 'text', 'description'])),
            90
          );
          const emphasis = truncateTextByChars(
            normalizeString(getFirstDefined(objectRecord, ['emphasis', 'weight', 'size'])),
            32
          );
          if (!type || !position || !content) return null;
          return {
            type,
            role: role || '補助要素',
            position,
            content,
            emphasis: emphasis || 'medium',
          };
        })
        .filter((item): item is LayoutPlan['objects'][number] => item !== null)
        .slice(0, 8)
    : [];

  if (!intent && !composition && objects.length === 0) return undefined;

  return {
    intent: intent || '記事内容を1枚のニューススライドとして伝える',
    composition: composition || '見出し、本文、図解要素を読み順が明確になるように配置',
    objects,
  };
}

type PromptBuildContext = {
  styleConfig: ImageStylePresetConfig;
  aspectRatio: ImageAspectRatio;
  styleReferenceImageIds: string[];
  styleReferenceNote: string;
};

// 画面に描く文字は「画面に描く文字」欄に「」で囲んで並べるだけにし、
// 「この文字列以外は描かない」は画像生成時のシステム指示(IMAGE_TEXT_RULE)で 1 回だけ伝える
function buildRichSlidePrompt(params: {
  visualCopy?: VisualCopy;
  layoutPlan?: LayoutPlan;
  context: PromptBuildContext;
}): string {
  const { visualCopy, layoutPlan, context } = params;
  const textLines = visualCopy
    ? formatImageTextSection([
        { label: '見出し', text: visualCopy.headline },
        { label: 'サブ見出し', text: visualCopy.subhead },
        { label: 'キー数値', text: visualCopy.keyNumber },
        ...visualCopy.bullets.map((bullet, index) => ({ label: `要点${index + 1}`, text: bullet })),
      ])
    : [];

  const drawableObjects =
    layoutPlan?.objects.filter((object) => object.type.trim().toLowerCase() !== 'source') ?? [];
  const objectLines = drawableObjects.map((object, index) => {
    return `- ${index + 1}: ${object.type} / ${object.position} / ${object.emphasis} / ${object.role} / ${object.content}`;
  });

  const referenceLines =
    context.styleReferenceImageIds.length > 0
      ? [
          'スタイル参照:',
          `- 添付されたスライドサンプル ${context.styleReferenceImageIds.length} 枚から、色、余白、文字階層、図形処理、カード/罫線の使い方を読み取って統一する。`,
          '- サンプル内の文字、数値、固有名詞、画像の内容は使わない。',
          context.styleReferenceNote ? `- 補足: ${context.styleReferenceNote}` : '',
        ].filter((line) => line.length > 0)
      : [];

  const promptLines = [
    'リッチニューススライド仕様',
    `画面比率: ${getImageAspectRatioLabel(context.aspectRatio)}`,
    `表現スタイル: ${context.styleConfig.id}`,
    `目的: ${layoutPlan?.intent || 'ニュース内容を1枚の完成スライドとして伝える'}`,
    `構図: ${layoutPlan?.composition || getImageLayoutVariant(context.aspectRatio, true, false)}`,
    ...textLines,
    'オブジェクト配置:',
    ...(objectLines.length > 0
      ? objectLines
      : ['- 1: headline / upper-left / large / 主情報 / 見出しを大きく配置']),
    ...referenceLines,
    '描画要件:',
    '- テキストと図形が重ならないよう、十分な余白と読み順を確保する。',
  ].filter((line) => line.length > 0);

  const promptText = sanitizeImagePromptForRendering(promptLines.join('\n'));
  return truncateTextByChars(promptText, MAX_IMAGE_PROMPT_CHARS);
}

// 抽出したスライド設計から、保存する画像プロンプトと、画面の文言・設計を作る
function buildImagePromptFromDesign(
  design: SlideDesign | undefined,
  context: PromptBuildContext
): { prompt: string; visualCopy?: VisualCopy; layoutPlan?: LayoutPlan } {
  const visualCopy = normalizeVisualCopy(design?.visualCopy);
  const layoutPlan = normalizeLayoutPlan(design?.layoutPlan);
  return {
    prompt: buildRichSlidePrompt({ visualCopy, layoutPlan, context }),
    visualCopy,
    layoutPlan,
  };
}

// 出力の形式と各項目の意味は構造化出力のスキーマで伝えるため、ここには JSON の例を書かない
const SLIDE_DESIGN_SYSTEM_PROMPT = `記事と対象パートから、そのパートを伝える文字入りニューススライド1枚を設計してください。

方針:
- このパートの内容を、1枚の完成したスライドとして正確に伝える。
- 画面に出す文字(見出し、サブ見出し、キー数値、要点)を積極的に設計する。見出しは短く強く、サブ見出しと要点は読みやすい長さにする。
- 何を、どこに、どの強さで、どの順に見せるかを具体的に決める。配置は自由に設計してよい。
- 出典は動画の締めカードで示すため、画面には出典を入れない。
- 人物・顔・手・ロゴ・透かし・番組名・QRコードは使わない。
- 記事にない事実、固有名詞、数値を加えない。
- 日本語で書く。`;

type ArticlePromptBlock = {
  articleId: string;
  text: string;
};

/**
 * 記事本文を ID 付きのタグで囲んだブロック。画像プロンプトの抽出ではパートごとに同じ記事を送るため、
 * このブロックを user の先頭に置いてキャッシュする。ID は記事の内容から決めるので、同じプロジェクト
 * (同じ記事)ではリクエストをまたいで変わらない(リクエストごとに変えるとキャッシュが壊れる)。
 */
function buildArticlePromptBlock(article: Article): ArticlePromptBlock {
  const cleanedBodyText = sanitizeArticleText(article.bodyText ?? '');
  const bodyText = cleanedBodyText || article.bodyText || '';
  const source = article.source ?? '';
  const articleId = `article-${createHash('sha256')
    .update(JSON.stringify([article.title, source, bodyText]))
    .digest('hex')
    .slice(0, 12)}`;
  const text = [
    `<article id="${articleId}">`,
    `タイトル: ${article.title}`,
    ...(source ? [`出典: ${source}`] : []),
    '本文:',
    bodyText,
    '</article>',
  ].join('\n');
  return { articleId, text };
}

// パートごとに変わる部分。記事ブロックの後ろ(キャッシュの対象外)に置く
function buildPartPrompt(part: GeneratedPart, partNumber: number, articleId: string): string {
  return [
    '対象パート:',
    `パート番号: ${partNumber}`,
    `タイトル: ${part.title || ''}`,
    `要約: ${part.summary || ''}`,
    `ナレーション: ${part.scriptText || ''}`,
    '',
    `記事 ${articleId} のうち、この対象パートを伝えるスライドを設計してください。`,
  ].join('\n');
}

async function extractSlideDesign(params: {
  article: ArticlePromptBlock;
  partPrompt: string;
  generationConfig: TextGenerationConfig;
}): Promise<{ design: SlideDesign; usage: OpenAIUsageSummary | null }> {
  const { article, partPrompt, generationConfig } = params;
  const selectedModel = generationConfig.model;

  if (isOpenAITextCompletionModel(selectedModel)) {
    const apiKey = await readApiKey('openai');
    if (!apiKey) {
      throw new Error(
        'OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。'
      );
    }

    const openai = new OpenAI({ apiKey, fetch: limitedOpenAIFetch });
    const reasoningEffort = resolveOpenAIReasoningEffort(generationConfig.openaiReasoningEffort);
    // 記事を別の content part にし、対応モデル(gpt-5.6 以降)では記事の末尾にキャッシュの
    // ブレークポイントを置く。prompt_cache_key はキャッシュの振り分けに使われるため記事ごとに固定する
    const articlePart: ChatCompletionContentPartText = {
      type: 'text',
      text: article.text,
      ...(supportsOpenAIPromptCacheBreakpoint(selectedModel)
        ? { prompt_cache_breakpoint: { mode: 'explicit' } }
        : {}),
    };
    const response = await withLocalizedStructuredOutputErrors(() =>
      openai.chat.completions.parse({
        model: selectedModel,
        messages: [
          { role: 'system', content: SLIDE_DESIGN_SYSTEM_PROMPT },
          { role: 'user', content: [articlePart, { type: 'text', text: partPrompt }] },
        ],
        prompt_cache_key: article.articleId,
        response_format: zodResponseFormat(SlideDesignSchema, 'slide_design'),
        ...buildOpenAITextGenerationOptions(selectedModel, reasoningEffort, 0.3),
      })
    );

    const choice = response.choices[0];
    if (choice?.message.refusal) {
      throw new Error(`AIが拒否しました: ${choice.message.refusal}`);
    }
    if (!choice?.message.parsed) {
      throw new Error('AIから構造化された応答を取得できませんでした');
    }
    return { design: choice.message.parsed, usage: mapOpenAIUsage(response.usage, response.model) };
  }

  if (isAnthropicTextCompletionModel(selectedModel)) {
    // 記事ブロックに cache_control を付け、system と記事までをパート間で共有する
    const structuredOutput = zodOutputFormat(SlideDesignSchema);
    const claudeResult = await generateClaudeTextContent({
      model: selectedModel,
      systemPrompt: SLIDE_DESIGN_SYSTEM_PROMPT,
      cachedUserPrefix: article.text,
      userPrompt: partPrompt,
      effort: generationConfig.claudeEffort,
      outputFormat: toClaudeOutputFormat(structuredOutput),
    });
    return {
      design: parseClaudeStructuredOutput(structuredOutput, claudeResult.text),
      usage: claudeResult.usage,
    };
  }

  // Gemini のキャッシュは先頭一致の暗黙キャッシュなので、記事を先頭に置く
  const geminiResult = await generateGeminiTextContent({
    model: resolveGeminiApiModel(selectedModel),
    systemPrompt: SLIDE_DESIGN_SYSTEM_PROMPT,
    userPrompt: `${article.text}\n\n${partPrompt}`,
    responseJsonSchema: toGeminiJsonSchema(SlideDesignSchema),
    thinkingLevel: generationConfig.geminiThinkingLevel,
  });
  return {
    design: parseStructuredJson(SlideDesignSchema, geminiResult.text),
    usage: geminiResult.usage,
  };
}

function resolveImagePromptContext(options?: ImagePromptGenerationOptions): PromptBuildContext {
  const styleReferenceImageIds = Array.isArray(options?.styleReferenceImageIds)
    ? Array.from(
        new Set(
          options.styleReferenceImageIds.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          )
        )
      ).slice(0, 3)
    : [];
  return {
    styleConfig: getImageStylePresetConfig(options?.stylePreset),
    aspectRatio: isImageAspectRatio(options?.aspectRatio)
      ? options.aspectRatio
      : DEFAULT_IMAGE_ASPECT_RATIO,
    styleReferenceImageIds,
    styleReferenceNote:
      typeof options?.styleReferenceNote === 'string' ? options.styleReferenceNote.trim() : '',
  };
}

function toImagePrompt(
  partId: string,
  design: SlideDesign | undefined,
  context: PromptBuildContext,
  createdAt: string
): ImagePrompt {
  const { prompt, visualCopy, layoutPlan } = buildImagePromptFromDesign(design, context);
  return {
    id: crypto.randomUUID(),
    partId,
    stylePreset: context.styleConfig.id,
    prompt,
    negativePrompt: context.styleConfig.negative,
    aspectRatio: context.aspectRatio,
    ...(visualCopy ? { visualCopy } : {}),
    ...(layoutPlan ? { layoutPlan } : {}),
    ...(context.styleReferenceImageIds.length > 0
      ? { styleReferenceImageIds: context.styleReferenceImageIds }
      : {}),
    version: 1,
    createdAt,
  };
}

// 画像プロンプト生成ハンドラ
registerOperation(
  'ai:generateImagePrompts',
  async (
    _,
    parts: GeneratedPart[],
    article: Article,
    options?: ImagePromptGenerationOptions
  ): Promise<{ prompts: ImagePrompt[]; usage: OpenAIUsageSummary | null }> => {
    const context = resolveImagePromptContext(options);
    const articleBlock = buildArticlePromptBlock(article);
    const generationConfig = await readTextGenerationConfig('image_prompt');
    // 記事ブロックのキャッシュ指定は、パートが 1 件のときも含めて常に付ける。
    // 注意: キャッシュは 1 本目の応答が始まってから読めるようになるため、最大 10 並列で同時に送ると
    // 最初の応答が始まる前に送ったリクエストはキャッシュを読めない。自動生成ジョブ
    // (ai:generateImagePromptForTarget)では、Claude のとき 1 本目の応答の開始を待ってから残りを送る
    // (electron/jobs/engine.ts)。この画面向けの一括生成は従来どおり同時に送る
    const extractionResults = await runWithConcurrency(parts, 10, (part, index) =>
      extractSlideDesign({
        article: articleBlock,
        partPrompt: buildPartPrompt(part, index + 1, articleBlock.articleId),
        generationConfig,
      })
    );
    const now = new Date().toISOString();
    const prompts = parts.map((part, index) =>
      toImagePrompt(part?.id || '', extractionResults[index]?.design, context, now)
    );
    const aggregatedUsage = aggregateUsageSummaries(
      extractionResults.map((result) => result.usage)
    );
    const usage =
      aggregatedUsage && isOpenAITextCompletionModel(generationConfig.model)
        ? { ...aggregatedUsage, model: generationConfig.model }
        : aggregatedUsage;

    return {
      prompts,
      usage,
    };
  }
);

// 単一ターゲットの画像プロンプト生成ハンドラ(自動生成ジョブはこの経路でパートを 1 件ずつ処理する)
registerOperation(
  'ai:generateImagePromptForTarget',
  async (
    _,
    parts: GeneratedPart[],
    article: Article,
    targetId: string,
    options?: ImagePromptGenerationOptions
  ): Promise<{ prompt: ImagePrompt; usage: OpenAIUsageSummary | null }> => {
    const context = resolveImagePromptContext(options);
    const targetPart = parts.find((part) => part.id === targetId);
    if (!targetPart) {
      throw new Error('対象パートが見つかりませんでした。');
    }

    // 記事ブロックにキャッシュを付けるので、同じ記事の 2 件目以降はキャッシュを読める
    const articleBlock = buildArticlePromptBlock(article);
    const generationConfig = await readTextGenerationConfig('image_prompt');
    const { design, usage } = await extractSlideDesign({
      article: articleBlock,
      partPrompt: buildPartPrompt(targetPart, targetPart.index + 1, articleBlock.articleId),
      generationConfig,
    });

    return {
      prompt: toImagePrompt(targetId, design, context, new Date().toISOString()),
      usage,
    };
  }
);

// コメント反映ハンドラ
registerOperation(
  'ai:applyComment',
  async (
    _,
    target: { type: 'script' | 'imagePrompt'; id: string; currentText: string },
    comment: string
  ): Promise<{ text: string; usage: OpenAIUsageSummary | null }> => {
    const scope: TextGenerationScope = target.type === 'script' ? 'script' : 'image_prompt';
    const generationConfig = await readTextGenerationConfig(scope);
    const selectedModel = generationConfig.model;
    const isScriptTarget = target.type === 'script';
    const systemPrompt = isScriptTarget
      ? 'あなたは報道動画のスクリプトエディターです。与えられたコメントに基づいてスクリプトを修正します。'
      : 'あなたは画像生成プロンプトのエディターです。与えられたコメントに基づいてプロンプトを修正します。';
    // 画像プロンプトは 3 社とも構造化出力で受け取るため、JSON の形式はプロンプトに書かずスキーマで伝える
    const userPrompt = isScriptTarget
      ? `以下のスクリプトを、コメントに基づいて修正してください。

## 現在の内容
${target.currentText}

## コメント（修正依頼）
${comment}

## 要件
- コメントの意図を反映した修正を行ってください
- 元の構成や意図はできるだけ維持してください
- 修正後の本文のみを出力してください（説明不要）`
      : `以下の画像生成プロンプトを、コメントに基づいて修正してください。

## 現在の内容
${target.currentText}

## コメント（修正依頼）
${comment}

## 要件
- コメントの意図を反映した修正を行ってください
- 元の構成や意図はできるだけ維持してください
- 画面に描く文字は「${IMAGE_TEXT_SECTION_LABEL}」欄に、1項目ずつ「」で囲んで書いてください`;

    let text = '';
    let usage: OpenAIUsageSummary | null = null;

    if (isOpenAITextCompletionModel(selectedModel)) {
      const apiKey = await readApiKey('openai');
      if (!apiKey) {
        throw new Error(
          'OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。'
        );
      }

      const openai = new OpenAI({ apiKey, fetch: limitedOpenAIFetch });
      const reasoningEffort = resolveOpenAIReasoningEffort(generationConfig.openaiReasoningEffort);
      if (isScriptTarget) {
        const response = await openai.chat.completions.create({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          ...buildOpenAITextGenerationOptions(selectedModel, reasoningEffort, 0.7),
        });
        const choice = response.choices[0];
        if (choice?.finish_reason === 'length') {
          throw new Error(
            'AIの応答が長さ上限で途中終了しました。入力を短くして再試行してください。'
          );
        }
        if (choice?.finish_reason === 'content_filter') {
          throw new Error(
            'AIの安全フィルターにより応答を完了できませんでした。入力内容を確認してください。'
          );
        }
        if (choice?.message.refusal) {
          throw new Error(`AIが拒否しました: ${choice.message.refusal}`);
        }
        text = choice?.message.content || '';
        usage = mapOpenAIUsage(response.usage, response.model);
      } else {
        const response = await withLocalizedStructuredOutputErrors(() =>
          openai.chat.completions.parse({
            model: selectedModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: zodResponseFormat(
              ImagePromptCommentPayloadSchema,
              'image_prompt_comment_payload'
            ),
            ...buildOpenAITextGenerationOptions(selectedModel, reasoningEffort, 0.7),
          })
        );
        const choice = response.choices[0];
        if (choice?.message.refusal) {
          throw new Error(`AIが拒否しました: ${choice.message.refusal}`);
        }
        if (!choice?.message.parsed) {
          throw new Error('AIから構造化された応答を取得できませんでした');
        }
        text = JSON.stringify(choice.message.parsed);
        usage = mapOpenAIUsage(response.usage, response.model);
      }
    } else if (isAnthropicTextCompletionModel(selectedModel)) {
      if (isScriptTarget) {
        const claudeResult = await generateClaudeTextContent({
          model: selectedModel,
          systemPrompt,
          userPrompt,
          effort: generationConfig.claudeEffort,
        });
        text = claudeResult.text;
        usage = claudeResult.usage;
      } else {
        const structuredOutput = zodOutputFormat(ImagePromptCommentPayloadSchema);
        const claudeResult = await generateClaudeTextContent({
          model: selectedModel,
          systemPrompt,
          userPrompt,
          effort: generationConfig.claudeEffort,
          outputFormat: toClaudeOutputFormat(structuredOutput),
        });
        text = JSON.stringify(parseClaudeStructuredOutput(structuredOutput, claudeResult.text));
        usage = claudeResult.usage;
      }
    } else {
      const apiModel = resolveGeminiApiModel(selectedModel);
      const geminiResult = await generateGeminiTextContent({
        model: apiModel,
        systemPrompt,
        userPrompt,
        ...(isScriptTarget
          ? {}
          : { responseJsonSchema: toGeminiJsonSchema(ImagePromptCommentPayloadSchema) }),
        thinkingLevel: generationConfig.geminiThinkingLevel,
      });
      text = geminiResult.text;
      usage = geminiResult.usage;
    }

    if (!text) {
      throw new Error('AIからの応答が空でした');
    }
    if (!isScriptTarget) {
      const parsed = tryParseJsonResponse<{ prompt?: unknown }>(text);
      const editedPrompt = truncateTextByChars(
        normalizeString(parsed?.prompt ?? text),
        MAX_IMAGE_PROMPT_CHARS
      );
      if (!editedPrompt) {
        throw new Error('AIからの応答が不正でした: prompt が空です');
      }
      text = editedPrompt;
    }

    return {
      text,
      usage,
    };
  }
);
