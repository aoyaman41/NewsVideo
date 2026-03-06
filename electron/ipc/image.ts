import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
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
  baseStyle: 'フラットなベクター調、非写実、情報整理しやすい明瞭な図解表現',
  colorPalette:
    '背景 #F6F7F9、主要線 #1F3552、補助線 #5C6B7A、アクセント #2C8E8A（単色）、文字 #0F172A',
  lighting: 'フラットでマットな質感',
  background: '余白を十分に取った明るい無地背景',
  density: '低め',
  layoutVariants: {
    dataAndLocation: '左右2カラム。左60%に主ビジュアル、右40%を上下2段（上:地図、下:図表）',
    dataOnly: '左右2カラム。左60%に主ビジュアル、右40%に図表パネル',
    locationOnly: '左右2カラム。左60%に主ビジュアル、右40%に地図パネル',
    general: '左右2カラム。左60%に主ビジュアル、右40%に補助情報パネル',
  },
  negative:
    '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
};

function getStylePreset(): StylePresetConfig {
  return INFOGRAPHIC_STYLE_PRESET;
}

const IMAGE_SYSTEM_POLICY_CORE = `タスク:
「指示」ブロックの内容に基づき、1枚の画像を生成する。

制約:
- 構図・要素配置・情報優先度は「指示」ブロックを最優先の描画仕様として扱う。
- 「指示」にない要素・見出し・数値・キャプションを追加しない。
- 画面内文字として描画してよいのは「指示」内の「画面テキスト」欄にある項目のみ。
- 「配置」「レイアウト方針」「要素」「情報の優先順位」などの見出し・説明文は描画しない。
- 「左45%」「右45%」「右上20%」などのサイズ比・座標メモは構図メタ情報として扱い、文字として描画しない。
- 「%」記号を文字として描画してよいのは、「画面テキスト」欄に含まれる値のみ。
- 文字を配置する場合は短いラベルまたは数値のみ。長文を配置しない。
- 写実表現は禁止。`;

// 異常な長文入力のみを防ぐための非常上限（通常運用では切り詰めない）
const MAX_USER_PROMPT_CHARS = 12000;
const MAX_NEGATIVE_PROMPT_CHARS = 4000;
const MAX_MODEL_INPUT_PROMPT_CHARS = 20000;

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

function getImageSize(imageResolution: ImageResolution): '1K' | '2K' | '4K' {
  switch (imageResolution) {
    case '2k':
      return '2K';
    case '4k':
      return '4K';
    default:
      return '1K';
  }
}

function buildImageSystemInstruction(prompt: ImagePrompt): string {
  const styleConfig = getStylePreset();
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
  const userPromptText = truncateTextByChars(prompt.prompt, MAX_USER_PROMPT_CHARS);
  const composedPrompt = [
    '描画ルール:',
    '- 画面内の文字は「画面テキスト」欄の項目のみを使用する。',
    '- 配置・レイアウト方針・要素・情報の優先順位・サイズ比（例: 左45%、右上20%）は画面に文字として描画しない。',
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

    const genAI = new GoogleGenAI({ apiKey });
    const { imageModel, imageResolution } = await readImageGenerationSettings();
    const enhancedPrompt = buildImagePromptText(prompt);
    const systemInstruction = buildImageSystemInstruction(prompt);
    const imageSize = getImageSize(imageResolution);

    const imageId = randomUUID();
    const dimensions = getDimensions(prompt.aspectRatio, imageResolution);
    logger.debug('[image:generate] Request prepared', {
      promptChars: enhancedPrompt.length,
      systemInstructionChars: systemInstruction.length,
      imageModel,
      imageResolution,
      imageSize,
    });

    const response = await withRetry(async () => {
      return genAI.models.generateContent({
        model: imageModel,
        contents: enhancedPrompt,
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

    // レスポンスから画像データを抽出
    const parts = response.candidates?.[0]?.content?.parts;
    logger.debug('[image:generate] Response received', {
      candidates: response.candidates?.length ?? 0,
      parts: parts?.length ?? 0,
      hasImagePart: Boolean(parts?.some((p) => p.inlineData?.data)),
    });

    if (!parts || parts.length === 0) {
      throw new Error('画像生成に失敗しました: レスポンスが空です');
    }

    // 画像パートを探す
    const imagePart = parts.find((part) => part.inlineData?.data);
    const base64Data = imagePart?.inlineData?.data || response.data;

    if (!base64Data) {
      throw new Error('画像生成に失敗しました: 画像データが見つかりません');
    }

    const mimeType = imagePart?.inlineData?.mimeType || 'image/png';

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

    const genAI = new GoogleGenAI({ apiKey });
    const { imageModel, imageResolution } = await readImageGenerationSettings();

    logger.info('[image:generateBatch] Start', { projectId, count: prompts.length });

    const settled = await Promise.all(
      prompts.map(async (prompt, index) => {
        try {
          const enhancedPrompt = buildImagePromptText(prompt);
          const systemInstruction = buildImageSystemInstruction(prompt);
          const imageSize = getImageSize(imageResolution);

          logger.debug('[image:generateBatch] Request prepared', {
            index: index + 1,
            total: prompts.length,
            promptId: prompt.id,
            promptChars: enhancedPrompt.length,
            systemInstructionChars: systemInstruction.length,
            imageModel,
            imageResolution,
            imageSize,
          });

          const imageId = randomUUID();
          const dimensions = getDimensions(prompt.aspectRatio, imageResolution);

          const response = await withRetry(async () => {
            return genAI.models.generateContent({
              model: imageModel,
              contents: enhancedPrompt,
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

          const parts = response.candidates?.[0]?.content?.parts;
          logger.debug('[image:generateBatch] Response received', {
            index: index + 1,
            candidates: response.candidates?.length ?? 0,
            parts: parts?.length ?? 0,
            hasImagePart: Boolean(parts?.some((p) => p.inlineData?.data)),
          });

          if (!parts || parts.length === 0) {
            throw new Error('レスポンスが空です');
          }

          const imagePart = parts.find((part) => part.inlineData?.data);
          const base64Data = imagePart?.inlineData?.data || response.data;

          if (!base64Data) {
            throw new Error('画像データが見つかりません');
          }

          const mimeType = imagePart?.inlineData?.mimeType || 'image/png';

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
