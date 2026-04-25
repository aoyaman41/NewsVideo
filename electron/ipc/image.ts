import { ipcMain, app, safeStorage } from 'electron';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import OpenAI, { toFile } from 'openai';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  getImageModelProvider,
  isImageModel,
  isImageResolution,
  type ImageModel,
  type ImageResolution,
  type ImageSizeTier,
} from '../../shared/constants/models';
import {
  getImageStylePresetConfig,
  type ImageAspectRatio,
  type ImageStylePreset,
} from '../../shared/project/imageStylePresets';
import { sanitizeImagePromptForRendering } from '../../shared/utils/imagePromptSanitizer';
import { logger } from '../utils/logger';

// シークレットファイルのパス
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');

// 設定ファイルのパス
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

// プロジェクトディレクトリのパス
const getProjectsPath = () => path.join(app.getPath('userData'), 'projects');

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

async function readImageGenerationSettings(): Promise<{
  imageModel: ImageModel;
  imageResolution: ImageResolution;
}> {
  let imageModel = DEFAULT_IMAGE_MODEL;
  let imageResolution = DEFAULT_IMAGE_RESOLUTION;

  try {
    const settingsPath = getSettingsPath();
    const content = await fs.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(content) as { imageModel?: string; imageResolution?: string };
    if (isImageModel(parsed.imageModel)) {
      imageModel = parsed.imageModel;
    }
    if (isImageResolution(parsed.imageResolution)) {
      imageResolution = parsed.imageResolution;
    }
  } catch {
    // 設定未作成時などはデフォルトを使用
  }

  return {
    imageModel,
    imageResolution,
  };
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

// 画像プロンプトの型
interface ImagePrompt {
  id: string;
  partId: string;
  stylePreset: ImageStylePreset;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: ImageAspectRatio;
  visualCopy?: {
    headline: string;
    subhead?: string;
    keyNumber?: string;
    bullets: string[];
  };
  layoutPlan?: {
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
  styleReferenceImageIds?: string[];
  version: number;
  createdAt: string;
}

const IMAGE_SYSTEM_POLICY_CORE = `タスク:
「指示」ブロックの内容に基づき、1枚の画像を生成する。

制約:
- 構図・要素配置・情報優先度は「指示」ブロックを最優先の描画仕様として扱う。
- 「指示」にない要素・見出し・数値・キャプションを追加しない。
- 画面内文字として描画してよいのは「指示」内の「画面コピー」「画面テキスト」「テキスト」欄にある項目のみ。
- 「配置」「オブジェクト配置」「レイアウト方針」「要素」「情報の優先順位」などの見出し・説明文は描画しない。
- レイアウト用の割合値・サイズメモ・座標メモは構図メタ情報として扱い、文字として描画しない。
- 割合値は「画面テキスト」欄に明示されたものだけを文字として扱う。
- 指定された見出し、サブ見出し、要点、数値は正確に描画する。出典表示や「出典: 記事本文」は描画しない。
- 写実表現は禁止。`;

// 異常な長文入力のみを防ぐための非常上限（通常運用では切り詰めない）
const MAX_USER_PROMPT_CHARS = 12000;
const MAX_NEGATIVE_PROMPT_CHARS = 4000;
const MAX_MODEL_INPUT_PROMPT_CHARS = 20000;
const IMAGE_BATCH_CONCURRENCY = 3;

type ImageBatchRunState = {
  cancelRequested: boolean;
};

const runningImageBatchProjects = new Map<string, ImageBatchRunState>();

function truncateTextByChars(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trim();
}

function normalizeNegativePrompt(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  const withoutPrefix = raw.replace(/^(strictly avoid|禁止|避けるべき要素)\s*[:：]\s*/i, '');
  const tokens = withoutPrefix
    .split(/[,、\n]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/^no\s+/i, ''));
  const seen = new Set<string>();
  const deduped = tokens.filter((token) => {
    const key = token.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.join(', ');
}

function getImageSize(imageResolution: ImageResolution): ImageSizeTier {
  switch (imageResolution) {
    case '2k':
      return '2K';
    case '4k':
      return '4K';
    default:
      return '1K';
  }
}

function extractImageUsage(
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
    | undefined
): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | null {
  if (!usage) return null;

  const inputTokens = Math.max(
    0,
    usage.promptTokenCount ?? usage.promptTokens ?? usage.prompt_token_count ?? 0
  );
  const outputTokens = Math.max(
    0,
    usage.responseTokenCount ??
      usage.candidatesTokenCount ??
      usage.completionTokens ??
      usage.candidates_token_count ??
      0
  );
  const totalTokens = Math.max(
    0,
    usage.totalTokenCount ?? usage.totalTokens ?? usage.total_token_count ?? 0
  );

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    inputTokens: inputTokens > 0 ? inputTokens : undefined,
    outputTokens: outputTokens > 0 ? outputTokens : undefined,
    totalTokens: totalTokens > 0 ? totalTokens : undefined,
  };
}

function buildImageSystemInstruction(prompt: ImagePrompt): string {
  const styleConfig = getImageStylePresetConfig(prompt.stylePreset);
  const styleLines = [
    styleConfig.baseStyle,
    `- 配色: ${styleConfig.colorPalette}`,
    `- 光・質感: ${styleConfig.lighting}`,
    `- 背景: ${styleConfig.background}`,
    `- 情報密度: ${styleConfig.density}`,
  ].join('\n');
  const negativeRaw = truncateTextByChars(
    normalizeNegativePrompt(prompt.negativePrompt || styleConfig.negative),
    MAX_NEGATIVE_PROMPT_CHARS
  );
  const strictAvoidSection = negativeRaw ? `禁止:\n${negativeRaw}` : '';

  const systemInstruction = [
    IMAGE_SYSTEM_POLICY_CORE,
    'スタイル方針:\n配色・質感・背景・情報密度は下記スタイルを固定適用する。指示内の色・トーン指定は採用しない。',
    `スタイル:\n${styleLines}`,
    strictAvoidSection,
  ]
    .filter((part) => part && part.length > 0)
    .join('\n\n');
  return truncateTextByChars(systemInstruction, MAX_MODEL_INPUT_PROMPT_CHARS);
}

function buildImagePromptText(prompt: ImagePrompt): string {
  const sanitizedPrompt = sanitizeImagePromptForRendering(prompt.prompt);
  const userPromptText = truncateTextByChars(sanitizedPrompt, MAX_USER_PROMPT_CHARS);
  const composedPrompt = [
    '描画ルール:',
    '- 画面内の文字は「画面テキスト」欄の項目のみを使用する。',
    '- 配置・レイアウト方針・要素・情報の優先順位に含まれるレイアウト用メモは画面に文字として描画しない。',
    '指示:',
    userPromptText,
  ]
    .filter((part) => part && part.length > 0)
    .join('\n\n');
  return truncateTextByChars(composedPrompt, MAX_MODEL_INPUT_PROMPT_CHARS);
}

// 画像アセットの型
interface ImageAsset {
  id: string;
  filePath: string;
  sourceType: 'generated' | 'imported';
  metadata: {
    width: number;
    height: number;
    mimeType: string;
    fileSize: number;
    createdAt: string;
    promptId?: string;
    tags: string[];
    generation?: {
      model: string;
      resolution: ImageResolution;
      imageSizeTier: ImageSizeTier;
      aspectRatio: ImageAspectRatio;
      inputTokens?: number;
      textInputTokens?: number;
      imageInputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };
}

interface ImageBatchGenerationError {
  index: number;
  promptId: string;
  partId?: string;
  error: string;
}

interface ImageBatchGenerationResult {
  images: ImageAsset[];
  errors: ImageBatchGenerationError[];
  requestedCount: number;
}

type StyleReferenceImage = {
  id: string;
  filePath: string;
  mimeType: string;
};

// アスペクト比から寸法を計算
function getDimensions(
  aspectRatio: ImageAspectRatio,
  imageResolution: ImageResolution
): { width: number; height: number } {
  const longEdge = imageResolution === '4k' ? 3840 : imageResolution === '2k' ? 2560 : 1920;

  switch (aspectRatio) {
    case '16:9':
      return { width: longEdge, height: Math.round((longEdge * 9) / 16) };
    case '1:1':
      return { width: longEdge, height: longEdge };
    case '9:16':
      return { width: Math.round((longEdge * 9) / 16), height: longEdge };
    default:
      return { width: longEdge, height: Math.round((longEdge * 9) / 16) };
  }
}

// プロジェクトパスを取得（IDからフォルダを検索）
async function getProjectPath(projectId: string): Promise<string> {
  const projectsDir = getProjectsPath();
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith('.newsproj')) {
      const projectPath = path.join(projectsDir, entry.name);
      const metaPath = path.join(projectPath, 'project.json');

      try {
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        if (meta.id === projectId) {
          return projectPath;
        }
      } catch {
        // 読み込み失敗時はスキップ
      }
    }
  }

  throw new Error(`Project not found: ${projectId}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveStyleReferenceImages(
  projectPath: string,
  prompt: ImagePrompt
): Promise<StyleReferenceImage[]> {
  const ids = Array.isArray(prompt.styleReferenceImageIds)
    ? Array.from(new Set(prompt.styleReferenceImageIds)).slice(0, 3)
    : [];
  if (ids.length === 0) return [];

  const [generatedImages, article] = await Promise.all([
    fs
      .readFile(path.join(projectPath, 'images.json'), 'utf-8')
      .then((content) => JSON.parse(content) as ImageAsset[])
      .catch(() => []),
    fs
      .readFile(path.join(projectPath, 'article.json'), 'utf-8')
      .then((content) => JSON.parse(content) as { importedImages?: ImageAsset[] })
      .catch(() => ({ importedImages: [] })),
  ]);

  const byId = new Map<string, ImageAsset>();
  for (const image of generatedImages) byId.set(image.id, image);
  for (const image of article.importedImages ?? []) byId.set(image.id, image);

  const references: StyleReferenceImage[] = [];
  for (const id of ids) {
    const image = byId.get(id);
    if (!image || !(await fileExists(image.filePath))) continue;
    references.push({
      id,
      filePath: image.filePath,
      mimeType: image.metadata.mimeType || 'image/png',
    });
  }

  return references;
}

// 画像をファイルに保存
async function saveImageToFile(
  base64Data: string,
  projectPath: string,
  imageId: string,
  mimeType: string
): Promise<string> {
  // 拡張子を決定
  const ext =
    mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : mimeType === 'image/gif'
          ? 'gif'
          : 'jpg';

  // プロジェクトの画像ディレクトリを作成
  const imagesDir = path.join(projectPath, 'images');
  await fs.mkdir(imagesDir, { recursive: true });

  // ファイルパスを生成
  const fileName = `${imageId}.${ext}`;
  const filePath = path.join(imagesDir, fileName);

  // Base64をデコードして保存
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.writeFile(filePath, buffer);

  return filePath;
}

function buildOpenAiImagePrompt(prompt: ImagePrompt): string {
  const systemInstruction = buildImageSystemInstruction(prompt);
  const userPrompt = buildImagePromptText(prompt);
  return truncateTextByChars(
    [systemInstruction, `ユーザー指示:\n${userPrompt}`].join('\n\n'),
    MAX_MODEL_INPUT_PROMPT_CHARS
  );
}

function getOpenAiImageQuality(imageResolution: ImageResolution): 'low' | 'medium' | 'high' {
  if (imageResolution === '4k') return 'high';
  if (imageResolution === '2k') return 'medium';
  return 'low';
}

function getOpenAiRequestedSize(
  aspectRatio: ImageAspectRatio,
  imageResolution: ImageResolution
): string {
  const { width, height } = getDimensions(aspectRatio, imageResolution);
  return `${width}x${height}`;
}

function getOpenAiFallbackSize(
  aspectRatio: ImageAspectRatio
): '1536x1024' | '1024x1024' | '1024x1536' {
  switch (aspectRatio) {
    case '1:1':
      return '1024x1024';
    case '9:16':
      return '1024x1536';
    default:
      return '1536x1024';
  }
}

function parseDimensionsFromSize(
  value: string | undefined,
  fallback: { width: number; height: number }
): { width: number; height: number } {
  if (!value) return fallback;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) return fallback;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function shouldRetryOpenAiWithFallback(error: unknown): boolean {
  return error instanceof Error && /size/i.test(error.message);
}

function extractOpenAiImageUsage(
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        input_tokens_details?: {
          text_tokens?: number;
          image_tokens?: number;
        };
      }
    | undefined
): {
  inputTokens?: number;
  textInputTokens?: number;
  imageInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | null {
  if (!usage) return null;

  const textInputTokens = Math.max(0, usage.input_tokens_details?.text_tokens ?? 0);
  const imageInputTokens = Math.max(0, usage.input_tokens_details?.image_tokens ?? 0);
  const inputTokens = Math.max(0, usage.input_tokens ?? textInputTokens + imageInputTokens);
  const outputTokens = Math.max(0, usage.output_tokens ?? 0);
  const totalTokens = Math.max(0, usage.total_tokens ?? 0);

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    inputTokens: inputTokens > 0 ? inputTokens : undefined,
    textInputTokens: textInputTokens > 0 ? textInputTokens : undefined,
    imageInputTokens: imageInputTokens > 0 ? imageInputTokens : undefined,
    outputTokens: outputTokens > 0 ? outputTokens : undefined,
    totalTokens: totalTokens > 0 ? totalTokens : undefined,
  };
}

async function generateGeminiImageAsset(params: {
  prompt: ImagePrompt;
  projectPath: string;
  imageId: string;
  imageModel: ImageModel;
  imageResolution: ImageResolution;
  genAI: GoogleGenAI;
  styleReferenceImages: StyleReferenceImage[];
}): Promise<ImageAsset> {
  const { prompt, projectPath, imageId, imageModel, imageResolution, genAI, styleReferenceImages } =
    params;
  const enhancedPrompt = buildImagePromptText(prompt);
  const systemInstruction = buildImageSystemInstruction(prompt);
  const imageSize = getImageSize(imageResolution);
  const dimensions = getDimensions(prompt.aspectRatio, imageResolution);
  const referenceParts = await Promise.all(
    styleReferenceImages.map(async (reference) => ({
      inlineData: {
        data: await fs.readFile(reference.filePath, 'base64'),
        mimeType: reference.mimeType,
      },
    }))
  );
  const contents =
    referenceParts.length > 0 ? [{ text: enhancedPrompt }, ...referenceParts] : enhancedPrompt;

  logger.debug('[image:generate] Request prepared', {
    promptChars: enhancedPrompt.length,
    systemInstructionChars: systemInstruction.length,
    imageModel,
    imageResolution,
    imageSize,
    styleReferenceCount: styleReferenceImages.length,
  });

  const response = await withRetry(async () => {
    return genAI.models.generateContent({
      model: imageModel,
      contents,
      config: {
        systemInstruction,
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: prompt.aspectRatio,
          imageSize,
        },
      },
    });
  });
  const usage = extractImageUsage(response.usageMetadata);

  const parts = response.candidates?.[0]?.content?.parts;
  logger.debug('[image:generate] Response received', {
    candidates: response.candidates?.length ?? 0,
    parts: parts?.length ?? 0,
    hasImagePart: Boolean(parts?.some((p) => p.inlineData?.data)),
  });

  if (!parts || parts.length === 0) {
    throw new Error('画像生成に失敗しました: レスポンスが空です');
  }

  const imagePart = parts.find((part) => part.inlineData?.data);
  const base64Data = imagePart?.inlineData?.data || response.data;

  if (!base64Data) {
    throw new Error('画像生成に失敗しました: 画像データが見つかりません');
  }

  const mimeType = imagePart?.inlineData?.mimeType || 'image/png';
  const filePath = await saveImageToFile(base64Data, projectPath, imageId, mimeType);
  const stats = await fs.stat(filePath);

  return {
    id: imageId,
    filePath,
    sourceType: 'generated',
    metadata: {
      width: dimensions.width,
      height: dimensions.height,
      mimeType,
      fileSize: stats.size,
      createdAt: new Date().toISOString(),
      promptId: prompt.id,
      tags: [],
      generation: {
        model: imageModel,
        resolution: imageResolution,
        imageSizeTier: imageSize,
        aspectRatio: prompt.aspectRatio,
        inputTokens: usage?.inputTokens,
        textInputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
      },
    },
  };
}

async function generateOpenAiImageAsset(params: {
  prompt: ImagePrompt;
  projectPath: string;
  imageId: string;
  imageModel: ImageModel;
  imageResolution: ImageResolution;
  openai: OpenAI;
  styleReferenceImages: StyleReferenceImage[];
}): Promise<ImageAsset> {
  const {
    prompt,
    projectPath,
    imageId,
    imageModel,
    imageResolution,
    openai,
    styleReferenceImages,
  } = params;
  const imageSizeTier = getImageSize(imageResolution);
  const requestedSize = getOpenAiRequestedSize(prompt.aspectRatio, imageResolution);
  const fallbackSize = getOpenAiFallbackSize(prompt.aspectRatio);
  const quality = getOpenAiImageQuality(imageResolution);
  const promptText = buildOpenAiImagePrompt(prompt);
  const openAiReferenceFiles =
    styleReferenceImages.length > 0
      ? await Promise.all(
          styleReferenceImages.map((reference) =>
            toFile(createReadStream(reference.filePath), path.basename(reference.filePath), {
              type: reference.mimeType,
            })
          )
        )
      : [];

  const requestImage = async (size: string) => {
    if (openAiReferenceFiles.length > 0) {
      return openai.images.edit({
        model: imageModel,
        image: openAiReferenceFiles,
        prompt: promptText,
        size: size as '1024x1024',
        quality,
        output_format: 'png',
      });
    }
    return openai.images.generate({
      model: imageModel,
      prompt: promptText,
      size: size as '1024x1024',
      quality,
      output_format: 'png',
    });
  };

  let finalSize = requestedSize;
  let response;
  try {
    response = await withRetry(async () => {
      return requestImage(requestedSize);
    });
  } catch (error) {
    if (requestedSize === fallbackSize || !shouldRetryOpenAiWithFallback(error)) {
      throw error;
    }

    logger.warn('[image:generate] OpenAI size fallback', {
      requestedSize,
      fallbackSize,
      error: error instanceof Error ? error.message : String(error),
    });
    finalSize = fallbackSize;
    response = await withRetry(async () => {
      return requestImage(fallbackSize);
    });
  }

  const base64Data = response.data?.[0]?.b64_json;
  if (!base64Data) {
    throw new Error('画像生成に失敗しました: OpenAIの応答に画像データが含まれていません');
  }

  const mimeType =
    response.output_format === 'jpeg'
      ? 'image/jpeg'
      : response.output_format === 'webp'
        ? 'image/webp'
        : 'image/png';
  const filePath = await saveImageToFile(base64Data, projectPath, imageId, mimeType);
  const stats = await fs.stat(filePath);
  const fallbackDimensions = getDimensions(prompt.aspectRatio, imageResolution);
  const dimensions = parseDimensionsFromSize(response.size ?? finalSize, fallbackDimensions);
  const usage = extractOpenAiImageUsage(response.usage);

  return {
    id: imageId,
    filePath,
    sourceType: 'generated',
    metadata: {
      width: dimensions.width,
      height: dimensions.height,
      mimeType,
      fileSize: stats.size,
      createdAt: new Date().toISOString(),
      promptId: prompt.id,
      tags: [],
      generation: {
        model: imageModel,
        resolution: imageResolution,
        imageSizeTier,
        aspectRatio: prompt.aspectRatio,
        inputTokens: usage?.inputTokens,
        textInputTokens: usage?.textInputTokens,
        imageInputTokens: usage?.imageInputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
      },
    },
  };
}

async function generateImageAsset(params: {
  prompt: ImagePrompt;
  projectPath: string;
  imageModel: ImageModel;
  imageResolution: ImageResolution;
  googleGenAI?: GoogleGenAI;
  openai?: OpenAI;
  styleReferenceImages?: StyleReferenceImage[];
}): Promise<ImageAsset> {
  const { prompt, projectPath, imageModel, imageResolution } = params;
  const imageId = randomUUID();
  const provider = getImageModelProvider(imageModel);
  const styleReferenceImages = params.styleReferenceImages ?? [];

  if (provider === 'openai') {
    if (!params.openai) {
      throw new Error('OpenAI client is not initialized');
    }
    return generateOpenAiImageAsset({
      prompt,
      projectPath,
      imageId,
      imageModel,
      imageResolution,
      openai: params.openai,
      styleReferenceImages,
    });
  }

  if (!params.googleGenAI) {
    throw new Error('Google GenAI client is not initialized');
  }
  return generateGeminiImageAsset({
    prompt,
    projectPath,
    imageId,
    imageModel,
    imageResolution,
    genAI: params.googleGenAI,
    styleReferenceImages,
  });
}

// 単一画像生成ハンドラ
ipcMain.handle(
  'image:generate',
  async (_, prompt: ImagePrompt, projectId: string): Promise<ImageAsset> => {
    const { imageModel, imageResolution } = await readImageGenerationSettings();
    const provider = getImageModelProvider(imageModel);
    const openaiApiKey = provider === 'openai' ? await readApiKey('openai') : null;
    const googleApiKey = provider === 'gemini' ? await readApiKey('google_ai') : null;
    if (provider === 'openai' && !openaiApiKey) {
      throw new Error(
        'OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。'
      );
    }
    if (provider === 'gemini' && !googleApiKey) {
      throw new Error(
        'Google AI APIキーが設定されていません。設定画面からAPIキーを入力してください。'
      );
    }

    const projectPath = await getProjectPath(projectId);
    const styleReferenceImages = await resolveStyleReferenceImages(projectPath, prompt);
    logger.debug('[image:generate] Start', {
      projectId,
      promptId: prompt.id,
      aspectRatio: prompt.aspectRatio,
      provider,
      imageModel,
      imageResolution,
      styleReferenceCount: styleReferenceImages.length,
    });

    return generateImageAsset({
      prompt,
      projectPath,
      imageModel,
      imageResolution,
      googleGenAI: googleApiKey ? new GoogleGenAI({ apiKey: googleApiKey }) : undefined,
      openai: openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : undefined,
      styleReferenceImages,
    });
  }
);

// バッチ画像生成ハンドラ
ipcMain.handle(
  'image:generateBatch',
  async (_, prompts: ImagePrompt[], projectId: string): Promise<ImageBatchGenerationResult> => {
    if (runningImageBatchProjects.has(projectId)) {
      throw new Error('このプロジェクトの画像一括生成は既に実行中です。完了を待ってください。');
    }

    if (prompts.length === 0) {
      return {
        images: [],
        errors: [],
        requestedCount: 0,
      };
    }

    const { imageModel, imageResolution } = await readImageGenerationSettings();
    const provider = getImageModelProvider(imageModel);
    const openaiApiKey = provider === 'openai' ? await readApiKey('openai') : null;
    const googleApiKey = provider === 'gemini' ? await readApiKey('google_ai') : null;
    if (provider === 'openai' && !openaiApiKey) {
      throw new Error(
        'OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。'
      );
    }
    if (provider === 'gemini' && !googleApiKey) {
      throw new Error(
        'Google AI APIキーが設定されていません。設定画面からAPIキーを入力してください。'
      );
    }

    const projectPath = await getProjectPath(projectId);
    const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : undefined;
    const genAI = googleApiKey ? new GoogleGenAI({ apiKey: googleApiKey }) : undefined;
    const runState: ImageBatchRunState = { cancelRequested: false };

    runningImageBatchProjects.set(projectId, runState);
    logger.info('[image:generateBatch] Start', {
      projectId,
      count: prompts.length,
      provider,
      imageModel,
      concurrency: Math.min(IMAGE_BATCH_CONCURRENCY, prompts.length),
    });

    try {
      type TaskResult =
        | { ok: true; index: number; imageAsset: ImageAsset }
        | {
            ok: false;
            index: number;
            promptId: string;
            partId?: string;
            error: string;
          };

      const settled: Array<TaskResult | undefined> = new Array(prompts.length);
      const workerCount = Math.max(1, Math.min(IMAGE_BATCH_CONCURRENCY, prompts.length));
      let cursor = 0;

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            if (runState.cancelRequested) return;

            const index = cursor;
            cursor += 1;
            if (index >= prompts.length) return;

            const prompt = prompts[index];
            try {
              logger.debug('[image:generateBatch] Request prepared', {
                index: index + 1,
                total: prompts.length,
                promptId: prompt.id,
                imageModel,
                imageResolution,
              });

              const styleReferenceImages = await resolveStyleReferenceImages(projectPath, prompt);
              if (runState.cancelRequested) return;

              const imageAsset = await generateImageAsset({
                prompt,
                projectPath,
                imageModel,
                imageResolution,
                googleGenAI: genAI,
                openai,
                styleReferenceImages,
              });
              if (runState.cancelRequested) return;

              logger.info('[image:generateBatch] Item complete', {
                index: index + 1,
                total: prompts.length,
                promptId: prompt.id,
                imageId: imageAsset.id,
              });

              settled[index] = { ok: true, index, imageAsset };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn('[image:generateBatch] Item failed', {
                index: index + 1,
                total: prompts.length,
                promptId: prompt.id,
                error: message,
              });
              settled[index] = {
                ok: false,
                index,
                promptId: prompt.id,
                partId: prompt.partId,
                error: message,
              };
            }
          }
        })
      );

      if (runState.cancelRequested) {
        throw new Error('キャンセルしました');
      }

      const results: ImageAsset[] = [];
      const errors: ImageBatchGenerationError[] = [];

      for (const item of settled) {
        if (!item) continue;
        if (item.ok) {
          results.push(item.imageAsset);
        } else {
          errors.push({
            index: item.index,
            promptId: item.promptId,
            partId: item.partId,
            error: item.error,
          });
        }
      }

      logger.info('[image:generateBatch] Complete', {
        successCount: results.length,
        errorCount: errors.length,
      });

      if (errors.length > 0) {
        logger.warn('[image:generateBatch] Partial failure', {
          successCount: results.length,
          errorCount: errors.length,
        });
      }

      if (errors.length > 0 && results.length === 0) {
        throw new Error(`全ての画像生成に失敗しました: ${errors.map((e) => e.error).join(', ')}`);
      }

      return {
        images: results,
        errors,
        requestedCount: prompts.length,
      };
    } finally {
      runningImageBatchProjects.delete(projectId);
    }
  }
);

ipcMain.handle(
  'image:cancelBatch',
  async (_, projectId?: string): Promise<{ success: boolean }> => {
    if (typeof projectId === 'string' && projectId.trim().length > 0) {
      const runState = runningImageBatchProjects.get(projectId);
      if (runState) runState.cancelRequested = true;
      return { success: true };
    }

    for (const runState of runningImageBatchProjects.values()) {
      runState.cancelRequested = true;
    }
    return { success: true };
  }
);

// 画像削除ハンドラ
ipcMain.handle('image:delete', async (_, filePath: string): Promise<{ success: boolean }> => {
  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    logger.error('Failed to delete image', error);
    return { success: false };
  }
});

// 画像コピーハンドラ（インポート用）
ipcMain.handle(
  'image:import',
  async (_, sourcePath: string, projectId: string): Promise<ImageAsset> => {
    // プロジェクトパスを取得
    const projectPath = await getProjectPath(projectId);

    const imageId = randomUUID();
    const ext = path.extname(sourcePath).toLowerCase();

    // プロジェクトの画像ディレクトリを作成
    const projectDir = path.join(projectPath, 'images');
    await fs.mkdir(projectDir, { recursive: true });

    // ファイルをコピー
    const fileName = `${imageId}${ext}`;
    const destPath = path.join(projectDir, fileName);
    await fs.copyFile(sourcePath, destPath);

    // ファイル情報を取得
    const stats = await fs.stat(destPath);

    // MIMEタイプを判定
    const mimeTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mimeType = mimeTypeMap[ext] || 'image/jpeg';

    // 画像サイズはデフォルト値（実際のサイズは取得が複雑なため）
    const imageAsset: ImageAsset = {
      id: imageId,
      filePath: destPath,
      sourceType: 'imported',
      metadata: {
        width: 1920,
        height: 1080,
        mimeType,
        fileSize: stats.size,
        createdAt: new Date().toISOString(),
        tags: [],
      },
    };

    return imageAsset;
  }
);
