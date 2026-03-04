import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  FIXED_IMAGE_STYLE_PRESET,
  isImageModel,
  isImageResolution,
  type ImageModel,
  type ImageResolution,
} from '../../shared/constants/models';
import { logger } from '../utils/logger';

// シークレットファイルのパス
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');

// 設定ファイルのパス
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

// プロジェクトディレクトリのパス
const getProjectsPath = () => path.join(app.getPath('userData'), 'projects');

type ImageAspectRatio = '16:9' | '1:1' | '9:16';

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
  stylePreset: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: ImageAspectRatio;
  version: number;
  createdAt: string;
}

type StylePresetConfig = {
  id: string;
  baseStyle: string;
  colorPalette: string;
  lighting: string;
  background: string;
  density: 'low' | 'medium' | 'high';
  layoutVariants: {
    dataAndLocation: string;
    dataOnly: string;
    locationOnly: string;
    general: string;
  };
  negative: string;
};

const INFOGRAPHIC_STYLE_PRESET: StylePresetConfig = {
  id: FIXED_IMAGE_STYLE_PRESET,
  baseStyle: '16:9 editorial infographic slide, flat clean vector style, no photorealism',
  colorPalette: 'white and light gray base, dark navy structure, one muted teal accent',
  lighting: 'flat and matte',
  background: 'plain light background with generous whitespace',
  density: 'low',
  layoutVariants: {
    dataAndLocation: 'Two-column layout: left 60% main visual, right 40% split top map and bottom chart',
    dataOnly: 'Two-column layout: left 60% main visual, right 40% chart panel',
    locationOnly: 'Two-column layout: left 60% main visual, right 40% map panel',
    general: 'Two-column layout: left 60% main visual, right 40% supporting information panel',
  },
  negative:
    '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
};

function getStylePreset(): StylePresetConfig {
  return INFOGRAPHIC_STYLE_PRESET;
}

const IMAGE_SYSTEM_PROMPT_CORE = `Generate exactly one 16:9 infographic slide.
Treat USER as direct layout instructions for what to place and where to place it.
Style must be flat infographic / vector-like, with clean shapes and whitespace.
No photorealism. No people. No faces. No logos. No watermarks.
If text is requested, use only short labels or numbers. Never add long sentences.
Do not invent extra objects, titles, or captions not requested in USER.`;

const MAX_USER_PROMPT_CHARS = 900;
const MAX_NEGATIVE_PROMPT_CHARS = 500;
const MAX_MODEL_INPUT_PROMPT_CHARS = 3200;

function truncateTextByChars(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trim();
}

function normalizeNegativePrompt(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  const withoutPrefix = raw.replace(/^strictly avoid:\s*/i, '');
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

function getAspectRatioLabel(aspectRatio: ImagePrompt['aspectRatio']): string {
  switch (aspectRatio) {
    case '1:1':
      return 'square';
    case '9:16':
      return 'vertical';
    default:
      return 'horizontal';
  }
}

function getImageResolutionLabel(imageResolution: ImageResolution): string {
  switch (imageResolution) {
    case '2k':
      return '2K';
    case '4k':
      return '4K';
    default:
      return 'Full HD';
  }
}

function buildImagePromptText(prompt: ImagePrompt, imageResolution: ImageResolution): string {
  const styleConfig = getStylePreset();
  const dimensions = getDimensions(prompt.aspectRatio, imageResolution);
  const styleLines = [
    styleConfig.baseStyle,
    `- Color: ${styleConfig.colorPalette}`,
    `- Lighting: ${styleConfig.lighting}`,
    `- Background: ${styleConfig.background}`,
    `- Information density: ${styleConfig.density}`,
  ].join('\n');
  const constraintsLine = `Aspect ratio: ${prompt.aspectRatio} (${getAspectRatioLabel(
    prompt.aspectRatio
  )}). Target resolution: ${dimensions.width}x${dimensions.height} (${getImageResolutionLabel(imageResolution)} preset). Keep this aspect ratio strictly.`;
  const negativeRaw = truncateTextByChars(
    normalizeNegativePrompt(prompt.negativePrompt || styleConfig.negative),
    MAX_NEGATIVE_PROMPT_CHARS
  );
  const strictlyAvoidLine = negativeRaw ? `Strictly avoid: ${negativeRaw}` : '';
  const userPromptText = truncateTextByChars(prompt.prompt, MAX_USER_PROMPT_CHARS);

  const composedPrompt = [
    `SYSTEM:\n${IMAGE_SYSTEM_PROMPT_CORE}`,
    `Style:\n${styleLines}`,
    `Constraints:\n${constraintsLine}`,
    strictlyAvoidLine,
    `USER:\n${userPromptText}`,
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
  };
}

// アスペクト比から寸法を計算
function getDimensions(
  aspectRatio: ImageAspectRatio,
  imageResolution: ImageResolution
): { width: number; height: number } {
  const longEdge =
    imageResolution === '4k' ? 3840 : imageResolution === '2k' ? 2560 : 1920;

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

// 画像をファイルに保存
async function saveImageToFile(
  base64Data: string,
  projectPath: string,
  imageId: string,
  mimeType: string
): Promise<string> {
  // 拡張子を決定
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';

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

// 単一画像生成ハンドラ
ipcMain.handle(
  'image:generate',
  async (
    _,
    prompt: ImagePrompt,
    projectId: string
  ): Promise<ImageAsset> => {
    const apiKey = await readApiKey('google_ai');

    if (!apiKey) {
      throw new Error('Google AI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }

    // プロジェクトパスを取得
    const projectPath = await getProjectPath(projectId);
    logger.debug('[image:generate] Start', {
      projectId,
      promptId: prompt.id,
      aspectRatio: prompt.aspectRatio,
    });

    const genAI = new GoogleGenerativeAI(apiKey);
    const { imageModel, imageResolution } = await readImageGenerationSettings();

    // 設定で選択された画像生成モデルを使用
    const model = genAI.getGenerativeModel({
      model: imageModel,
    });

    const enhancedPrompt = buildImagePromptText(prompt, imageResolution);

    const imageId = randomUUID();
    const dimensions = getDimensions(prompt.aspectRatio, imageResolution);
    logger.debug('[image:generate] Request prepared', {
      promptChars: enhancedPrompt.length,
      imageModel,
      imageResolution,
    });

    const response = await withRetry(async () => {
      return model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: enhancedPrompt }],
        }],
      });
    });

    // レスポンスから画像データを抽出
    const result = response.response;
    const parts = result.candidates?.[0]?.content?.parts;
    logger.debug('[image:generate] Response received', {
      candidates: result.candidates?.length ?? 0,
      parts: parts?.length ?? 0,
      hasImagePart: Boolean(parts?.some((p) => p.inlineData?.mimeType?.startsWith('image/'))),
    });

    if (!parts || parts.length === 0) {
      throw new Error('画像生成に失敗しました: レスポンスが空です');
    }

    // 画像パートを探す
    const imagePart = parts.find(part => part.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart?.inlineData) {
      throw new Error('画像生成に失敗しました: 画像データが見つかりません');
    }

    const base64Data = imagePart.inlineData.data;
    const mimeType = imagePart.inlineData.mimeType || 'image/png';

    // 画像をファイルに保存
    const filePath = await saveImageToFile(base64Data, projectPath, imageId, mimeType);

    // ファイルサイズを取得
    const stats = await fs.stat(filePath);

    const imageAsset: ImageAsset = {
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
      },
    };

    return imageAsset;
  }
);

// バッチ画像生成ハンドラ
ipcMain.handle(
  'image:generateBatch',
  async (
    _,
    prompts: ImagePrompt[],
    projectId: string
  ): Promise<ImageAsset[]> => {
    const apiKey = await readApiKey('google_ai');

    if (!apiKey) {
      throw new Error('Google AI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }

    // プロジェクトパスを取得
    const projectPath = await getProjectPath(projectId);

    const genAI = new GoogleGenerativeAI(apiKey);
    const { imageModel, imageResolution } = await readImageGenerationSettings();

    // 設定で選択された画像生成モデルを使用
    const model = genAI.getGenerativeModel({
      model: imageModel,
    });

    logger.info('[image:generateBatch] Start', { projectId, count: prompts.length });

    const settled = await Promise.all(
      prompts.map(async (prompt, index) => {
        try {
          const enhancedPrompt = buildImagePromptText(prompt, imageResolution);

          logger.debug('[image:generateBatch] Request prepared', {
            index: index + 1,
            total: prompts.length,
            promptId: prompt.id,
            promptChars: enhancedPrompt.length,
            imageModel,
            imageResolution,
          });

          const imageId = randomUUID();
          const dimensions = getDimensions(prompt.aspectRatio, imageResolution);

          const response = await withRetry(async () => {
            return model.generateContent({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: enhancedPrompt }],
                },
              ],
            });
          });

          const result = response.response;
          const parts = result.candidates?.[0]?.content?.parts;
          logger.debug('[image:generateBatch] Response received', {
            index: index + 1,
            candidates: result.candidates?.length ?? 0,
            parts: parts?.length ?? 0,
            hasImagePart: Boolean(parts?.some((p) => p.inlineData?.mimeType?.startsWith('image/'))),
          });

          if (!parts || parts.length === 0) {
            throw new Error('レスポンスが空です');
          }

          const imagePart = parts.find((part) => part.inlineData?.mimeType?.startsWith('image/'));

          if (!imagePart?.inlineData) {
            throw new Error('画像データが見つかりません');
          }

          const base64Data = imagePart.inlineData.data;
          const mimeType = imagePart.inlineData.mimeType || 'image/png';

          const filePath = await saveImageToFile(base64Data, projectPath, imageId, mimeType);
          const stats = await fs.stat(filePath);

          const imageAsset: ImageAsset = {
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
            },
          };

          return { ok: true as const, index, imageAsset };
        } catch (error) {
          return {
            ok: false as const,
            index,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    const results: ImageAsset[] = [];
    const errors: { index: number; error: string }[] = [];

    for (const item of settled) {
      if (item.ok) {
        results.push(item.imageAsset);
      } else {
        errors.push({ index: item.index, error: item.error });
      }
    }

    if (errors.length > 0) {
      logger.warn('[image:generateBatch] Partial failure', {
        successCount: results.length,
        errorCount: errors.length,
      });
    }

    if (errors.length > 0 && results.length === 0) {
      throw new Error(`全ての画像生成に失敗しました: ${errors.map(e => e.error).join(', ')}`);
    }

    return results;
  }
);

// 画像削除ハンドラ
ipcMain.handle(
  'image:delete',
  async (_, filePath: string): Promise<{ success: boolean }> => {
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      logger.error('Failed to delete image', error);
      return { success: false };
    }
  }
);

// 画像コピーハンドラ（インポート用）
ipcMain.handle(
  'image:import',
  async (
    _,
    sourcePath: string,
    projectId: string
  ): Promise<ImageAsset> => {
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
