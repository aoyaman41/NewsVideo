import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import OpenAI from 'openai';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod/v3';
import {
  DEFAULT_IMAGE_PROMPT_TEXT_MODEL,
  DEFAULT_SCRIPT_TEXT_MODEL,
  GEMINI_TEXT_COMPLETION_MODEL,
  getDefaultGeminiThinkingLevel,
  getDefaultOpenAIReasoningEffort,
  getSupportedGeminiThinkingLevels,
  getSupportedOpenAIReasoningEfforts,
  isOpenAITextCompletionModel,
  isTextCompletionModel,
  isGeminiTextCompletionModel,
  supportsOpenAITemperature,
  type GeminiThinkingLevel,
  type OpenAITextCompletionModel,
  type OpenAIReasoningEffort,
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
import { PRESENTATION_PROFILE_PRESET_CLOSING_LINES } from '../../shared/project/presentationProfile';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../shared/settings/appSettings';
import { sanitizeImagePromptForRendering } from '../../shared/utils/imagePromptSanitizer';

// シークレットファイルのパス
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

type TextGenerationScope = 'script' | 'image_prompt';
const GEMINI_3_PRO_API_MODEL_ID = 'gemini-3-pro-preview';

type TextGenerationConfig = {
  model: TextCompletionModel;
  openaiReasoningEffort: OpenAIReasoningEffort;
  geminiThinkingLevel: GeminiThinkingLevel;
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

// 指数バックオフ + ジッター付きリトライ
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最後の試行では待機しない
      if (attempt < maxRetries - 1) {
        // 指数バックオフ + ジッター
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

type OpenAIUsageSummary = {
  provider?: 'openai' | 'gemini';
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  model?: string;
};

function mapOpenAIUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
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
    totalTokens: usage?.total_tokens,
    model,
  };
}

function mapGeminiUsage(
  usage:
    | {
        promptTokenCount?: number;
        responseTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        prompt_token_count?: number;
        candidates_token_count?: number;
        total_token_count?: number;
      }
    | undefined,
  model?: string
): OpenAIUsageSummary | null {
  if (!usage && !model) return null;
  return {
    provider: 'gemini',
    inputTokens: usage?.promptTokenCount ?? usage?.promptTokens ?? usage?.prompt_token_count,
    outputTokens:
      usage?.responseTokenCount ??
      usage?.candidatesTokenCount ??
      usage?.completionTokens ??
      usage?.candidates_token_count,
    totalTokens: usage?.totalTokenCount ?? usage?.totalTokens ?? usage?.total_token_count,
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
    totalTokens: sum((usage) => usage.totalTokens),
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

async function generateGeminiTextContent(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  responseMimeType?: string;
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
        temperature: params.temperature,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
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

function resolveGeminiApiModel(selectedModel: TextCompletionModel): string {
  if (selectedModel === GEMINI_TEXT_COMPLETION_MODEL) {
    return GEMINI_3_PRO_API_MODEL_ID;
  }
  return selectedModel;
}

function resolveOpenAIReasoningEffort(
  value: OpenAIReasoningEffort
): Exclude<OpenAIReasoningEffort, 'default'> | null {
  return value === 'default' ? null : value;
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
  };
  try {
    const settingsPath = getSettingsPath();
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = normalizeSettings(JSON.parse(content));
    const selectedModel = scope === 'script' ? settings.scriptTextModel : settings.imagePromptTextModel;
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
          settings.geminiThinkingLevel as Exclude<GeminiThinkingLevel, 'default' | 'medium'>
        )
        ? settings.geminiThinkingLevel
        : getDefaultGeminiThinkingLevel(model)
      : settings.geminiThinkingLevel;
    return {
      model,
      openaiReasoningEffort,
      geminiThinkingLevel,
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

function normalizeSlideSpecText(value: unknown): string {
  if (typeof value !== 'string') return '';

  let text = value.trim();
  if (!text) return '';

  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*/, '');
    text = text.replace(/\s*```$/, '');
  }

  const anchor = text.indexOf('スライド仕様:');
  if (anchor >= 0) {
    text = text.slice(anchor);
  }

  return text.trim();
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

// スクリプト生成プロンプト
function createScriptGenerationPrompt(article: Article, options: ScriptOptions): string {
  const toneDescription = {
    formal: '丁寧でフォーマルな',
    casual: 'カジュアルで親しみやすい',
    news: 'ニュースキャスターのような客観的で明瞭な',
  };

  const tone = options.tone || 'news';
  const targetPartCount = options.targetPartCount || 5;
  const targetDuration = options.targetDurationPerPartSec || 30;
  const closingLine = typeof options.closingLine === 'string' ? options.closingLine.trim() : '';
  const closingInstruction = closingLine
    ? `5. 最後のパートの末尾に「${closingLine}」を入れてください`
    : '5. 最後のパートの末尾に定型の締め文を入れないでください';

  return `あなたは情報動画のスクリプトライターです。以下の記事を、${targetPartCount}個のパートに分割し、各パートのナレーションスクリプトを作成してください。

## 記事情報
タイトル: ${article.title}
${article.source ? `出典: ${article.source}` : ''}

## 記事本文
${article.bodyText}

## 要件
1. ${toneDescription[tone]}トーンで書いてください
2. 各パートは約${targetDuration}秒（日本語で約${Math.round(targetDuration * 4)}文字）のナレーションになるようにしてください
3. 視聴者が理解しやすいよう、論理的な流れで構成してください
4. 重要な情報を漏らさないようにしてください
${closingInstruction}

## 出力形式
以下のJSON形式で出力してください：

{
  "parts": [
    {
      "title": "パートのタイトル",
      "summary": "このパートの概要（1-2文）",
      "scriptText": "ナレーションスクリプト本文",
      "durationEstimateSec": 推定秒数（数値）
    }
  ]
}

JSONのみを出力してください。説明や補足は不要です。`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimTrailingClosingLine(text: string, closingLine: string): string {
  const pattern = new RegExp(`(?:\\s|\\u3000|\\n)*${escapeRegExp(closingLine)}[。！!？?\\s\\u3000]*$`);
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
ipcMain.handle(
  'ai:generateScript',
  async (
    _,
    article: Article,
    options: ScriptOptions = {}
  ): Promise<{ parts: GeneratedPart[]; usage: OpenAIUsageSummary | null }> => {
    const generationConfig = await readTextGenerationConfig('script');
    const selectedModel = generationConfig.model;
    const scriptSystemPrompt =
      'あなたは情報動画のスクリプトライターです。与えられた記事を読みやすいナレーションスクリプトに変換します。';
    const scriptUserPrompt = createScriptGenerationPrompt(article, options);

    let parsed: {
      parts: Array<{
        title: string;
        summary: string;
        scriptText: string;
        durationEstimateSec: number;
      }>;
    };
    let usage: OpenAIUsageSummary | null = null;

    if (isOpenAITextCompletionModel(selectedModel)) {
      const apiKey = await readApiKey('openai');
      if (!apiKey) {
        throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
      }

      const openai = new OpenAI({ apiKey });
      const reasoningEffort = resolveOpenAIReasoningEffort(generationConfig.openaiReasoningEffort);
      const response = await withRetry(async () => {
        return openai.chat.completions.parse({
          model: selectedModel,
          messages: [
            { role: 'system', content: scriptSystemPrompt },
            { role: 'user', content: scriptUserPrompt },
          ],
          response_format: { type: 'json_object' },
          ...buildOpenAITextGenerationOptions(selectedModel, reasoningEffort, 0.7),
        });
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('AIからの応答が空でした');
      }

      parsed = parseJsonResponse(content);
      usage = mapOpenAIUsage(response.usage, response.model);
    } else {
      const apiModel = resolveGeminiApiModel(selectedModel);
      const geminiResult = await generateGeminiTextContent({
        model: apiModel,
        systemPrompt: scriptSystemPrompt,
        userPrompt: scriptUserPrompt,
        temperature: 0.7,
        responseMimeType: 'application/json',
        thinkingLevel: generationConfig.geminiThinkingLevel,
      });
      parsed = parseJsonResponse(geminiResult.text);
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
  version: number;
  createdAt: string;
};

type ImagePromptGenerationOptions = {
  stylePreset?: ImageStylePreset;
  aspectRatio?: ImageAspectRatio;
};

const QuantFactSchema = z.object({
  metric: z.string(),
  direction: z.enum(['increase', 'decrease', 'stable', 'comparison', 'unknown']),
  value: z.string(),
  unit: z.string(),
  timeframe: z.string(),
});

const VisualSlotSchema = z.object({
  slot: z.enum(['left', 'right', 'center', 'top', 'bottom']),
  elementType: z.enum([
    'barChart',
    'lineChart',
    'areaChart',
    'pieChart',
    'map',
    'diagram',
    'iconCluster',
    'abstractPattern',
    'flowArrows',
    'timeline',
  ]),
  source: z.string(),
});

const ImagePromptExtractionSchema = z.object({
  prompts: z.array(
    z.object({
      topic: z.string(),
      entities: z.array(z.string()),
      locations: z.array(z.string()),
      quantFacts: z.array(QuantFactSchema),
      visualSlots: z.array(VisualSlotSchema),
      heroSubject: z.string(),
      heroSetting: z.string(),
      compositionNote: z.string(),
    })
  ),
});

type ImagePromptExtraction = z.infer<typeof ImagePromptExtractionSchema>;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const MAX_EXTRACTED_TEXT_CHARS = 60;
const MAX_VISUAL_SLOT_SOURCE_CHARS = 40;
const MAX_COMPOSITION_NOTE_CHARS = 120;
// 異常系ガード用の非常上限（通常は切り詰めない想定）
const MAX_IMAGE_PROMPT_CHARS = 12000;

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

type QuantFact = {
  metric: string;
  direction?: 'increase' | 'decrease' | 'stable' | 'comparison' | 'unknown';
  value?: string;
  unit?: string;
  timeframe?: string;
};

function normalizeQuantFacts(value: unknown, limit: number): QuantFact[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((fact) => {
      if (!fact || typeof fact !== 'object') return null;
      const metric = truncateTextByChars(
        normalizeString((fact as { metric?: unknown }).metric),
        MAX_EXTRACTED_TEXT_CHARS
      );
      if (!metric) return null;
      const directionRaw = normalizeString((fact as { direction?: unknown }).direction);
      const direction =
        directionRaw === 'increase' ||
        directionRaw === 'decrease' ||
        directionRaw === 'stable' ||
        directionRaw === 'comparison'
          ? directionRaw
          : 'unknown';
      const valueStr = truncateTextByChars(
        normalizeString((fact as { value?: unknown }).value),
        MAX_EXTRACTED_TEXT_CHARS
      );
      const unit = truncateTextByChars(
        normalizeString((fact as { unit?: unknown }).unit),
        MAX_EXTRACTED_TEXT_CHARS
      );
      const timeframe = truncateTextByChars(
        normalizeString((fact as { timeframe?: unknown }).timeframe),
        MAX_EXTRACTED_TEXT_CHARS
      );
      return {
        metric,
        direction,
        value: valueStr,
        unit,
        timeframe,
      } as QuantFact;
    })
    .filter((item): item is QuantFact => item !== null);
  return items.slice(0, limit);
}

function describeQuantFactsJa(facts: QuantFact[]): string {
  return facts
    .map((fact) => {
      const parts: string[] = [];
      parts.push(fact.metric);
      if (fact.direction && fact.direction !== 'unknown') {
        const directionWord =
          fact.direction === 'increase'
            ? '増加'
            : fact.direction === 'decrease'
              ? '減少'
              : fact.direction === 'stable'
                ? '横ばい'
                : '比較';
        parts.push(`（${directionWord}）`);
      }
      if (fact.value) {
        parts.push(`数値 ${fact.value}${fact.unit || ''}`);
      }
      if (fact.timeframe) {
        parts.push(`期間 ${fact.timeframe}`);
      }
      return parts.join(' ');
    })
    .join(' / ');
}

const ALLOWED_ELEMENT_TYPES = [
  'barChart',
  'lineChart',
  'areaChart',
  'pieChart',
  'map',
  'diagram',
  'iconCluster',
  'abstractPattern',
  'flowArrows',
  'timeline',
] as const;

type AllowedElementType = (typeof ALLOWED_ELEMENT_TYPES)[number];

const ELEMENT_TYPE_LABELS_JA: Record<AllowedElementType, string> = {
  barChart: '棒グラフ風',
  lineChart: '折れ線グラフ風',
  areaChart: '面グラフ風',
  pieChart: '円グラフ風',
  map: '地図',
  diagram: '図解',
  iconCluster: 'アイコン群',
  abstractPattern: '抽象パターン',
  flowArrows: 'フロー矢印',
  timeline: 'タイムライン',
};

const SLOT_LABELS_JA: Record<VisualSlot['slot'], string> = {
  left: '左',
  right: '右',
  center: '中央',
  top: '上',
  bottom: '下',
};

const DATA_ELEMENT_TYPES = new Set<AllowedElementType>([
  'barChart',
  'lineChart',
  'areaChart',
  'pieChart',
  'timeline',
]);

const LOCATION_ELEMENT_TYPES = new Set<AllowedElementType>(['map']);

const CHART_LIKE_TYPES = new Set<AllowedElementType>([
  'barChart',
  'lineChart',
  'areaChart',
  'pieChart',
  'timeline',
  'map',
]);

const FORBIDDEN_TERMS = [
  '番組',
  '放送局',
  '局名',
  '番組名',
  '番組タイトル',
  'キャスター',
  '記者',
  'アナウンサー',
  'インタビュー',
  '人物',
  '顔',
];

function containsForbiddenTerm(value: string): boolean {
  return FORBIDDEN_TERMS.some((term) => value.includes(term));
}

function normalizeExtractedText(value: unknown, sourceText: string): string {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (!sourceText.includes(raw)) return '';
  if (containsForbiddenTerm(raw)) return '';
  return truncateTextByChars(raw, MAX_EXTRACTED_TEXT_CHARS);
}

function normalizeCompositionNote(value: unknown): string {
  const raw = normalizeString(value);
  if (!raw) return '';
  const trimmed = truncateTextByChars(raw, MAX_COMPOSITION_NOTE_CHARS);
  if (containsForbiddenTerm(trimmed)) return '';
  if (isNoiseLine(trimmed)) return '';
  return trimmed;
}

const ALLOWED_SLOT_NAMES = new Set(['left', 'right', 'center', 'top', 'bottom']);

type VisualSlot = {
  slot: 'left' | 'right' | 'center' | 'top' | 'bottom';
  elementType: AllowedElementType;
  source?: string;
};

function normalizeElementType(value: unknown): AllowedElementType | null {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return null;
  const normalized = raw.replace(/[_\s-]/g, '');
  const map: Record<string, AllowedElementType> = {
    barchart: 'barChart',
    linechart: 'lineChart',
    areachart: 'areaChart',
    piechart: 'pieChart',
    map: 'map',
    geomap: 'map',
    regionmap: 'map',
    diagram: 'diagram',
    iconcluster: 'iconCluster',
    abstractpattern: 'abstractPattern',
    flowarrows: 'flowArrows',
    timeline: 'timeline',
  };
  const mapped = map[normalized];
  if (!mapped) return null;
  return ALLOWED_ELEMENT_TYPES.includes(mapped) ? mapped : null;
}

function normalizeSlotName(value: unknown): VisualSlot['slot'] | null {
  const name = normalizeString(value).toLowerCase();
  if (!name || !ALLOWED_SLOT_NAMES.has(name)) return null;
  return name as VisualSlot['slot'];
}

function normalizeVisualSlots(value: unknown, limit: number): VisualSlot[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((slot) => {
      if (!slot || typeof slot !== 'object') return null;
      const slotName = normalizeSlotName((slot as { slot?: unknown }).slot);
      const elementType = normalizeElementType((slot as { elementType?: unknown }).elementType);
      if (!slotName || !elementType) return null;
      const source = truncateTextByChars(
        normalizeString((slot as { source?: unknown }).source),
        MAX_VISUAL_SLOT_SOURCE_CHARS
      );
      return {
        slot: slotName,
        elementType,
        source: source || undefined,
      } as VisualSlot;
    })
    .filter((item): item is VisualSlot => item !== null);
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

function normalizeLooseQuantFacts(value: unknown, limit: number): QuantFact[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => {
      const record = toObjectRecord(item);
      if (!record) return null;
      const metric = truncateTextByChars(
        normalizeString(getFirstDefined(record, ['metric', 'name', 'title', 'item', 'label'])),
        MAX_EXTRACTED_TEXT_CHARS
      );
      if (!metric) return null;
      const directionRaw = normalizeString(getFirstDefined(record, ['direction', 'trend']));
      const direction = (
        directionRaw === 'increase' ||
          directionRaw === 'decrease' ||
          directionRaw === 'stable' ||
          directionRaw === 'comparison'
          ? directionRaw
          : 'unknown'
      ) as QuantFact['direction'];
      const valueStr = truncateTextByChars(
        normalizeString(getFirstDefined(record, ['value', 'number', 'amount'])),
        MAX_EXTRACTED_TEXT_CHARS
      );
      const unit = truncateTextByChars(
        normalizeString(getFirstDefined(record, ['unit'])),
        MAX_EXTRACTED_TEXT_CHARS
      );
      const timeframe = truncateTextByChars(
        normalizeString(getFirstDefined(record, ['timeframe', 'period', 'date'])),
        MAX_EXTRACTED_TEXT_CHARS
      );
      return {
        metric,
        direction,
        value: valueStr,
        unit,
        timeframe,
      } as QuantFact;
    })
    .filter((item): item is QuantFact => item !== null);
  return normalized.slice(0, limit);
}

function normalizeLooseVisualSlots(value: unknown, limit: number): VisualSlot[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => {
      const record = toObjectRecord(item);
      if (!record) return null;
      const slotName = normalizeSlotName(getFirstDefined(record, ['slot', 'position', 'area']));
      const elementType = normalizeElementType(
        getFirstDefined(record, ['elementType', 'element_type', 'element', 'type'])
      );
      if (!slotName || !elementType) return null;
      const source = truncateTextByChars(
        normalizeString(getFirstDefined(record, ['source', 'reference', 'basis'])),
        MAX_VISUAL_SLOT_SOURCE_CHARS
      );
      return {
        slot: slotName,
        elementType,
        source: source || undefined,
      } as VisualSlot;
    })
    .filter((item): item is VisualSlot => item !== null);
  return normalized.slice(0, limit);
}

function coerceImagePromptExtraction(raw: unknown): ImagePromptExtraction {
  const direct = ImagePromptExtractionSchema.safeParse(raw);
  if (direct.success) return direct.data;

  const root = toObjectRecord(raw);
  const rawPrompts =
    (root ? getFirstDefined(root, ['prompts', 'items', 'data']) : undefined) ?? raw;

  const promptItems = Array.isArray(rawPrompts)
    ? rawPrompts
    : toObjectRecord(rawPrompts)
      ? [rawPrompts]
      : root && getFirstDefined(root, ['topic', 'subject'])
        ? [root]
        : [];

  const prompts = promptItems.map((item) => {
    const record = toObjectRecord(item) || {};
    const topic = truncateTextByChars(
      normalizeString(getFirstDefined(record, ['topic', 'subject', 'theme'])),
      MAX_EXTRACTED_TEXT_CHARS
    );
    const entities = normalizeLooseStringArray(
      getFirstDefined(record, ['entities', 'entityList', 'entity_list', 'entity', 'keywords']),
      5
    );
    const locations = normalizeLooseStringArray(
      getFirstDefined(record, ['locations', 'locationList', 'location_list', 'location']),
      3
    );

    const quantFactsSource = getFirstDefined(record, ['quantFacts', 'quant_facts', 'facts']);
    const quantFacts = normalizeLooseQuantFacts(quantFactsSource, 3).map((fact) => ({
      metric: fact.metric,
      direction: fact.direction ?? 'unknown',
      value: fact.value || '',
      unit: fact.unit || '',
      timeframe: fact.timeframe || '',
    }));

    const visualSlotsSource = getFirstDefined(record, ['visualSlots', 'visual_slots', 'slots']);
    const visualSlots = normalizeLooseVisualSlots(visualSlotsSource, 3).map((slot) => ({
      slot: slot.slot,
      elementType: slot.elementType,
      source: slot.source || '',
    }));

    const heroSubject = truncateTextByChars(
      normalizeString(getFirstDefined(record, ['heroSubject', 'hero_subject', 'mainSubject'])),
      MAX_EXTRACTED_TEXT_CHARS
    );
    const heroSetting = truncateTextByChars(
      normalizeString(getFirstDefined(record, ['heroSetting', 'hero_setting', 'mainSetting'])),
      MAX_EXTRACTED_TEXT_CHARS
    );
    const compositionNote = truncateTextByChars(
      normalizeString(
        getFirstDefined(record, ['compositionNote', 'composition_note', 'layoutNote', 'layout_note'])
      ),
      MAX_COMPOSITION_NOTE_CHARS
    );

    return {
      topic,
      entities,
      locations,
      quantFacts,
      visualSlots,
      heroSubject,
      heroSetting,
      compositionNote,
    };
  });

  const fallback = ImagePromptExtractionSchema.safeParse({ prompts });
  if (fallback.success) return fallback.data;
  return { prompts: [] };
}

type PromptBuildContext = {
  articleText: string;
  styleConfig: ImageStylePresetConfig;
  aspectRatio: ImageAspectRatio;
};

function buildImagePromptText(
  candidate: Record<string, unknown> | null | undefined,
  context: PromptBuildContext
): string {
  const p = candidate ?? {};
  const sourceText = context.articleText;

  const directSlideSpec = normalizeSlideSpecText(
    (p as { slideSpec?: unknown; compositionNote?: unknown }).slideSpec ??
      (p as { compositionNote?: unknown }).compositionNote
  );
  if (directSlideSpec) {
    const normalizedSlideSpec = sanitizeImagePromptForRendering(directSlideSpec);
    if (normalizedSlideSpec) {
      return truncateTextByChars(normalizedSlideSpec, MAX_IMAGE_PROMPT_CHARS);
    }
  }

  const rawTopic = normalizeString(
    (p as { topic?: unknown; subject?: unknown }).topic ?? (p as { subject?: unknown }).subject
  );
  const topic =
    rawTopic && sourceText.includes(rawTopic) && !containsForbiddenTerm(rawTopic)
      ? truncateTextByChars(rawTopic, MAX_EXTRACTED_TEXT_CHARS)
      : '';

  const entities = normalizeStringArray((p as { entities?: unknown }).entities, 5).filter(
    (item) => sourceText.includes(item) && !containsForbiddenTerm(item)
  );
  const locations = normalizeStringArray((p as { locations?: unknown }).locations, 3).filter((item) => sourceText.includes(item));

  const quantFactsRaw = normalizeQuantFacts((p as { quantFacts?: unknown }).quantFacts, 3);
  const quantFacts = quantFactsRaw.filter((fact) => {
    return (
      (fact.metric && sourceText.includes(fact.metric)) ||
      (fact.value && sourceText.includes(fact.value)) ||
      (fact.timeframe && sourceText.includes(fact.timeframe))
    );
  });

  const visualSlotsRaw = normalizeVisualSlots((p as { visualSlots?: unknown }).visualSlots, 3);
  const visualSlots = visualSlotsRaw
    .map((slot) => {
      const nextSource =
        slot.source && sourceText.includes(slot.source)
          ? truncateTextByChars(slot.source, MAX_VISUAL_SLOT_SOURCE_CHARS)
          : undefined;
      return { ...slot, source: nextSource };
    })
    .filter((slot) => {
      if (DATA_ELEMENT_TYPES.has(slot.elementType)) {
        return quantFacts.length > 0;
      }
      if (LOCATION_ELEMENT_TYPES.has(slot.elementType)) {
        return locations.length > 0;
      }
      return true;
    });

  const hasData = quantFacts.length > 0 || visualSlots.some((slot) => DATA_ELEMENT_TYPES.has(slot.elementType));
  const hasLocation =
    locations.length > 0 || visualSlots.some((slot) => LOCATION_ELEMENT_TYPES.has(slot.elementType));

  const resolvedSlots: VisualSlot[] = visualSlots;

  const layout = getImageLayoutVariant(context.aspectRatio, hasData, hasLocation);
  const heroSubject = normalizeExtractedText((p as { heroSubject?: unknown }).heroSubject, sourceText);
  const heroSetting = normalizeExtractedText((p as { heroSetting?: unknown }).heroSetting, sourceText);
  const compositionNote = normalizeCompositionNote((p as { compositionNote?: unknown }).compositionNote);
  const layoutInstruction = compositionNote || layout;

  const mainVisualParts: string[] = [];
  if (heroSubject) mainVisualParts.push(heroSubject);
  if (heroSetting) mainVisualParts.push(heroSetting);
  const mainVisual = mainVisualParts.length > 0 ? mainVisualParts.join(' / ') : topic || '抽象化した主題';

  const slotInstructions = resolvedSlots.map((slot) => {
    const label = ELEMENT_TYPE_LABELS_JA[slot.elementType];
    const slotLabel = SLOT_LABELS_JA[slot.slot];
    const sourceLabel = slot.source ? `（根拠:「${slot.source}」）` : '';
    const qualifier = CHART_LIKE_TYPES.has(slot.elementType) ? '（簡略図）' : '';
    return `${slotLabel}: ${label}${sourceLabel}${qualifier}`;
  });

  const detailLines: string[] = [];
  if (quantFacts.length > 0) {
    detailLines.push(`- 数値情報: ${describeQuantFactsJa(quantFacts)}`);
  }
  if (locations.length > 0) {
    detailLines.push(`- 地理情報: ${locations.join('、')}`);
  }
  if (entities.length > 0) {
    detailLines.push(`- 補助要素: ${entities.join('、')}`);
  }

  const backgroundFragments: string[] = [];
  if (topic) backgroundFragments.push(topic);
  if (quantFacts.length > 0) backgroundFragments.push(`数値 ${describeQuantFactsJa(quantFacts)}`);
  if (locations.length > 0) backgroundFragments.push(`地理 ${locations.join('、')}`);
  const backgroundSummary = backgroundFragments.join(' / ') || '対象パートの背景情報';
  const intentSummary =
    hasData || hasLocation
      ? '主題と根拠情報を一目で理解できるように整理する'
      : '主題の要点を一目で理解できるように整理する';

  const promptLines = [
    'スライド仕様',
    `画面比率: ${getImageAspectRatioLabel(context.aspectRatio)}`,
    `表現スタイル: ${context.styleConfig.id}`,
    `背景: ${backgroundSummary}`,
    `意図: ${intentSummary}`,
    `主題: ${topic || 'このパートの要点を1枚で説明'}`,
    `主ビジュアル: ${mainVisual}（人物なし）`,
    `レイアウト: ${layoutInstruction}`,
    slotInstructions.length > 0 ? '配置:' : '配置: 右側パネルに補助情報を配置',
    ...slotInstructions.map((line) => `- ${line}`),
    detailLines.length > 0 ? '要素:' : '',
    ...detailLines,
    'テキスト: 見出し・ラベル・数値のみ。長文禁止',
  ].filter((line) => line.length > 0);

  const promptText = sanitizeImagePromptForRendering(promptLines.join('\n'));
  return truncateTextByChars(promptText, MAX_IMAGE_PROMPT_CHARS);
}

function createSinglePartExtractionPrompts(articleContext: string, partContext: string): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = `タスク:
入力の記事情報と対象パート情報から、1枚分の「スライド仕様書」を作成してください。
出力は日本語のみ。前置き・説明文・Markdownは禁止。指定フォーマットのみ出力してください。

制約:
- 目的は「このパートを1枚で正確に伝える」こと。
- 配置指示は解釈余地が出ないように書く（何を/どこに/どの大きさ/どの順に見るか）。
- 要素ごとのサイズ感は「大・中・小」または「主・補助」で示す。割合数値は使わない。
- 視線誘導（最初に何を見せ、次に何を読ませるか）を必ず示す。
- 画面内テキストは短ラベルのみ（1ラベル8文字以内、最大6個）。
- 人物・顔・手・ロゴ・透かし・番組名・QRコードは禁止。
- 推測で新事実を追加しない。入力にない事実は書かない。
- 冗長表現を避け、全体900文字以内。

出力フォーマット:
スライド仕様:
主題:
伝える1文:
背景要約:
意図:
情報の優先順位:
- 第1:
- 第2:
- 第3:
主ビジュアル:
レイアウト方針:
視線誘導:
配置:
- 左(サイズ感/内容):
- 中央(サイズ感/内容):
- 右上(サイズ感/内容):
- 右下(サイズ感/内容):
要素:
- データ要素:
- 地理要素:
- 補助要素:
画面テキスト:
- 1:
- 2:
- 3:
- 4:
- 5:
- 6:

出力例1:
スライド仕様:
主題: 原油価格の上昇
伝える1文: 供給懸念で原油先物が上昇した
背景要約: 産油地域の不安定化と需給懸念
意図: 価格上昇の理由と規模を一目で理解させる
情報の優先順位:
- 第1: 原油価格が上昇した事実
- 第2: 上昇幅の数値
- 第3: 地理的な背景要因
主ビジュアル: 原油ドラム缶と上向き矢印
レイアウト方針: 左に主題を大きく置き、右を上下2段に分けて根拠を配置
視線誘導: 左中央の矢印 → 右下の数値グラフ → 右上の地図
配置:
- 左(サイズ感/内容): 大 / 原油ドラム缶群と上昇矢印
- 中央(サイズ感/内容): 未使用 / なし
- 右上(サイズ感/内容): 小 / 産油地域の簡易地図
- 右下(サイズ感/内容): 小 / 価格推移の折れ線グラフ
要素:
- データ要素: 直近高値、前日比
- 地理要素: 中東の産油地域
- 補助要素: 注意アイコンを1つ
画面テキスト:
- 1: 原油先物
- 2: 前日比
- 3: 上昇
- 4:
- 5:
- 6:

出力例2:
スライド仕様:
主題: 訪日客数の回復
伝える1文: 訪日客数が前年同月比で回復した
背景要約: 入国規制緩和後の需要回復
意図: 回復傾向を数値と内訳で短時間に把握させる
情報の優先順位:
- 第1: 訪日客数が回復した事実
- 第2: 前年同月比の伸び
- 第3: 国別の内訳
主ビジュアル: 空港到着ゲートと増加アイコン
レイアウト方針: 左に主ビジュアルを大きく置き、右を上下に分割
視線誘導: 左の主ビジュアル → 右下の棒グラフ → 右上の円グラフ
配置:
- 左(サイズ感/内容): 大 / 到着ゲート図解と増加アイコン
- 中央(サイズ感/内容): 未使用 / なし
- 右上(サイズ感/内容): 小 / 国別比率の円グラフ
- 右下(サイズ感/内容): 中 / 月次推移の棒グラフ
要素:
- データ要素: 前年同月比、月次推移
- 地理要素: 主要3市場
- 補助要素: 飛行機アイコン
画面テキスト:
- 1: 訪日客数
- 2: 前年比
- 3: 国別比率
- 4:
- 5:
- 6:
`;

  const userPrompt = `記事情報:
${articleContext}

対象パート:
${partContext}

この対象パートを伝えるための「スライド仕様」を作成してください。`;

  return { systemPrompt, userPrompt };
}

async function extractSinglePartPromptCandidate(params: {
  articleContext: string;
  partContext: string;
  generationConfig: TextGenerationConfig;
}): Promise<{ candidate: Record<string, unknown> | undefined; usage: OpenAIUsageSummary | null }> {
  const { systemPrompt, userPrompt } = createSinglePartExtractionPrompts(
    params.articleContext,
    params.partContext
  );
  const selectedModel = params.generationConfig.model;

  let resolvedParsed: ImagePromptExtraction | null = null;
  let usage: OpenAIUsageSummary | null = null;

  if (isOpenAITextCompletionModel(selectedModel)) {
    const apiKey = await readApiKey('openai');
    if (!apiKey) {
      throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }

    const openai = new OpenAI({ apiKey });
    const reasoningEffort = resolveOpenAIReasoningEffort(params.generationConfig.openaiReasoningEffort);
    const response = await withRetry(async () => {
      return openai.chat.completions.create({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...buildOpenAITextGenerationOptions(selectedModel, reasoningEffort, 0.3),
      });
    });

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error('AIからの応答が空でした');
    }
    if (message.refusal) {
      throw new Error(`AIが拒否しました: ${message.refusal}`);
    }

    const textContent = normalizeString(message.content);
    const parsed = textContent ? tryParseJsonResponse<unknown>(textContent) : null;
    if (parsed) {
      resolvedParsed = coerceImagePromptExtraction(parsed);
    } else {
      const slideSpec = normalizeSlideSpecText(textContent);
      resolvedParsed = {
        prompts: [
          {
            topic: '',
            entities: [],
            locations: [],
            quantFacts: [],
            visualSlots: [],
            heroSubject: '',
            heroSetting: '',
            compositionNote: slideSpec,
          },
        ],
      };
    }
    usage = mapOpenAIUsage(response.usage, response.model);
  } else {
    const apiModel = resolveGeminiApiModel(selectedModel);
    const geminiResult = await generateGeminiTextContent({
      model: apiModel,
      systemPrompt,
      userPrompt,
      temperature: 0.3,
      thinkingLevel: params.generationConfig.geminiThinkingLevel,
    });
    const parsed = tryParseJsonResponse<unknown>(geminiResult.text);
    if (parsed) {
      resolvedParsed = coerceImagePromptExtraction(parsed);
    } else {
      const slideSpec = normalizeSlideSpecText(geminiResult.text);
      resolvedParsed = {
        prompts: [
          {
            topic: '',
            entities: [],
            locations: [],
            quantFacts: [],
            visualSlots: [],
            heroSubject: '',
            heroSetting: '',
            compositionNote: slideSpec,
          },
        ],
      };
    }
    usage = geminiResult.usage;
  }

  if (!resolvedParsed) {
    throw new Error('AIからの応答が空でした');
  }

  return {
    candidate: resolvedParsed.prompts?.[0] as Record<string, unknown> | undefined,
    usage,
  };
}

// 画像プロンプト生成ハンドラ
ipcMain.handle(
  'ai:generateImagePrompts',
  async (
    _,
    parts: GeneratedPart[],
    article: Article,
    options?: ImagePromptGenerationOptions
  ): Promise<{
    prompts: Array<{
      id: string;
      partId: string;
      stylePreset: ImageStylePreset;
      prompt: string;
      negativePrompt: string;
      aspectRatio: ImageAspectRatio;
      version: number;
      createdAt: string;
    }>;
    usage: OpenAIUsageSummary | null;
  }> => {
    const styleConfig = getImageStylePresetConfig(options?.stylePreset);
    const aspectRatio = isImageAspectRatio(options?.aspectRatio)
      ? options.aspectRatio
      : DEFAULT_IMAGE_ASPECT_RATIO;
    const cleanedBodyText = sanitizeArticleText(article.bodyText ?? '');
    const bodyTextForPrompt = cleanedBodyText || article.bodyText || '';
    const articleText = `${article.title}\n${article.source ?? ''}\n${bodyTextForPrompt}`.trim();
    const articleContext = `タイトル: ${article.title}\n${article.source ? `出典: ${article.source}` : ''}\n本文:\n${bodyTextForPrompt}`;
    const generationConfig = await readTextGenerationConfig('image_prompt');
    const extractionResults = await runWithConcurrency(
      parts,
      10,
      async (
        part,
        index
      ): Promise<{ candidate: Record<string, unknown> | undefined; usage: OpenAIUsageSummary | null }> => {
        const partContext = [
          `パート番号: ${index + 1}`,
          `タイトル: ${part.title || ''}`,
          `要約: ${part.summary || ''}`,
          `ナレーション: ${part.scriptText || ''}`,
        ].join('\n');
        return extractSinglePartPromptCandidate({
          articleContext,
          partContext,
          generationConfig,
        });
      }
    );
    const now = new Date().toISOString();
    const promptContext = { articleText, styleConfig, aspectRatio };
    const prompts = parts.map((part, index: number) => {
      const candidate = extractionResults[index]?.candidate;
      const finalPrompt = buildImagePromptText(candidate, promptContext);

      return {
        id: crypto.randomUUID(),
        partId: part?.id || '',
        stylePreset: styleConfig.id,
        prompt: finalPrompt,
        negativePrompt: styleConfig.negative,
        aspectRatio,
        version: 1,
        createdAt: now,
      };
    });
    const usage = aggregateUsageSummaries(extractionResults.map((result) => result.usage));

    return {
      prompts,
      usage,
    };
  }
);

// 単一ターゲットの画像プロンプト生成ハンドラ
ipcMain.handle(
  'ai:generateImagePromptForTarget',
  async (
    _,
    parts: GeneratedPart[],
    article: Article,
    targetId: string,
    options?: ImagePromptGenerationOptions
  ): Promise<{ prompt: ImagePrompt; usage: OpenAIUsageSummary | null }> => {
    const styleConfig = getImageStylePresetConfig(options?.stylePreset);
    const aspectRatio = isImageAspectRatio(options?.aspectRatio)
      ? options.aspectRatio
      : DEFAULT_IMAGE_ASPECT_RATIO;
    const cleanedBodyText = sanitizeArticleText(article.bodyText ?? '');
    const bodyTextForPrompt = cleanedBodyText || article.bodyText || '';
    const articleText = `${article.title}\n${article.source ?? ''}\n${bodyTextForPrompt}`.trim();
    const articleContext = `タイトル: ${article.title}\n${article.source ? `出典: ${article.source}` : ''}\n本文:\n${bodyTextForPrompt}`;

    const targetPart = parts.find((part) => part.id === targetId);
    if (!targetPart) {
      throw new Error('対象パートが見つかりませんでした。');
    }

    const partContext = [
      `パート番号: ${targetPart.index + 1}`,
      `タイトル: ${targetPart.title || ''}`,
      `要約: ${targetPart.summary || ''}`,
      `ナレーション: ${targetPart.scriptText || ''}`,
    ].join('\n');
    const generationConfig = await readTextGenerationConfig('image_prompt');
    const { candidate, usage } = await extractSinglePartPromptCandidate({
      articleContext,
      partContext,
      generationConfig,
    });
    const promptText = buildImagePromptText(candidate, { articleText, styleConfig, aspectRatio });

    const now = new Date().toISOString();
    const prompt: ImagePrompt = {
      id: crypto.randomUUID(),
      partId: targetId,
      stylePreset: styleConfig.id,
      prompt: promptText,
      negativePrompt: styleConfig.negative,
      aspectRatio,
      version: 1,
      createdAt: now,
    };

    return {
      prompt,
      usage,
    };
  }
);

// コメント反映ハンドラ
ipcMain.handle(
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
      : `あなたは画像生成プロンプトのエディターです。与えられたコメントに基づいてプロンプトを修正します。
出力は JSON オブジェクトのみ（説明文・Markdown・前置き禁止）です。`;
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
- prompt は ${MAX_IMAGE_PROMPT_CHARS} 文字以内
- 出力は JSON のみ（説明不要）

## 出力形式（JSONのみ）
{
  "prompt": ""
}

JSONのみを出力してください。`;

    let text = '';
    let usage: OpenAIUsageSummary | null = null;

    if (isOpenAITextCompletionModel(selectedModel)) {
      const apiKey = await readApiKey('openai');
      if (!apiKey) {
        throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
      }

      const openai = new OpenAI({ apiKey });
      const reasoningEffort = resolveOpenAIReasoningEffort(generationConfig.openaiReasoningEffort);
      const response = await withRetry(async () => {
        return openai.chat.completions.create({
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          ...buildOpenAITextGenerationOptions(selectedModel, reasoningEffort, 0.7),
        });
      });
      text = response.choices[0]?.message?.content || '';
      usage = mapOpenAIUsage(response.usage, response.model);
    } else {
      const apiModel = resolveGeminiApiModel(selectedModel);
      const geminiResult = await generateGeminiTextContent({
        model: apiModel,
        systemPrompt,
        userPrompt,
        temperature: 0.7,
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
