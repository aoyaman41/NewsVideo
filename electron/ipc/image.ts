import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

// シークレットファイルのパス
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');

// 設定ファイルのパス
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

// プロジェクトディレクトリのパス
const getProjectsPath = () => path.join(app.getPath('userData'), 'projects');

type ImageModel = 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
type ImageResolution = 'fhd' | '2k' | '4k';
type ImageAspectRatio = '16:9' | '1:1' | '9:16';

const DEFAULT_IMAGE_MODEL: ImageModel = 'gemini-3.1-flash-image-preview';
const DEFAULT_IMAGE_RESOLUTION: ImageResolution = 'fhd';
const SUPPORTED_IMAGE_MODELS = new Set<ImageModel>([
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
]);
const SUPPORTED_IMAGE_RESOLUTIONS = new Set<ImageResolution>(['fhd', '2k', '4k']);

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
    if (parsed.imageModel && SUPPORTED_IMAGE_MODELS.has(parsed.imageModel as ImageModel)) {
      imageModel = parsed.imageModel as ImageModel;
    }
    if (
      parsed.imageResolution &&
      SUPPORTED_IMAGE_RESOLUTIONS.has(parsed.imageResolution as ImageResolution)
    ) {
      imageResolution = parsed.imageResolution as ImageResolution;
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

const STYLE_PRESETS: Record<string, StylePresetConfig> = {
  news_broadcast: {
    id: 'news_broadcast',
    baseStyle:
      'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
    colorPalette:
      'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
    lighting: 'soft natural light, matte, low contrast',
    background: 'white to very light gray, minimal, no heavy grid, no vignette',
    density: 'low',
    layoutVariants: {
      dataAndLocation: 'Flexible info blocks with generous margins; include chart-like and map-like elements if useful',
      dataOnly: 'Flexible info blocks with generous margins; include a chart-like element if useful',
      locationOnly: 'Flexible info blocks with generous margins; include a map-like element if useful',
      general: 'Flexible info blocks with generous margins; keep a clear editorial grid',
    },
    negative:
      '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
  },
  documentary: {
    id: 'documentary',
    baseStyle:
      'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
    colorPalette:
      'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
    lighting: 'soft natural light, matte, low contrast',
    background: 'white to very light gray, minimal, no heavy grid, no vignette',
    density: 'low',
    layoutVariants: {
      dataAndLocation: 'Flexible info blocks with generous margins; include chart-like and map-like elements if useful',
      dataOnly: 'Flexible info blocks with generous margins; include a chart-like element if useful',
      locationOnly: 'Flexible info blocks with generous margins; include a map-like element if useful',
      general: 'Flexible info blocks with generous margins; keep a clear editorial grid',
    },
    negative:
      '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
  },
  infographic: {
    id: 'infographic',
    baseStyle:
      'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
    colorPalette:
      'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
    lighting: 'soft natural light, matte, low contrast',
    background: 'white to very light gray, minimal, no heavy grid, no vignette',
    density: 'low',
    layoutVariants: {
      dataAndLocation: 'Flexible info blocks with generous margins; include chart-like and map-like elements if useful',
      dataOnly: 'Flexible info blocks with generous margins; include a chart-like element if useful',
      locationOnly: 'Flexible info blocks with generous margins; include a map-like element if useful',
      general: 'Flexible info blocks with generous margins; keep a clear editorial grid',
    },
    negative:
      '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
  },
  photorealistic: {
    id: 'photorealistic',
    baseStyle:
      'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
    colorPalette:
      'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
    lighting: 'soft natural light, matte, low contrast',
    background: 'white to very light gray, minimal, no heavy grid, no vignette',
    density: 'low',
    layoutVariants: {
      dataAndLocation: 'Flexible info blocks with generous margins; include chart-like and map-like elements if useful',
      dataOnly: 'Flexible info blocks with generous margins; include a chart-like element if useful',
      locationOnly: 'Flexible info blocks with generous margins; include a map-like element if useful',
      general: 'Flexible info blocks with generous margins; keep a clear editorial grid',
    },
    negative:
      '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
  },
  illustration: {
    id: 'illustration',
    baseStyle:
      'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
    colorPalette:
      'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
    lighting: 'soft natural light, matte, low contrast',
    background: 'white to very light gray, minimal, no heavy grid, no vignette',
    density: 'low',
    layoutVariants: {
      dataAndLocation: 'Flexible info blocks with generous margins; include chart-like and map-like elements if useful',
      dataOnly: 'Flexible info blocks with generous margins; include a chart-like element if useful',
      locationOnly: 'Flexible info blocks with generous margins; include a map-like element if useful',
      general: 'Flexible info blocks with generous margins; keep a clear editorial grid',
    },
    negative:
      '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
  },
};

const STYLE_PRESET_ALIASES: Record<string, string> = {
  news_panel: 'news_broadcast',
};

function getStylePreset(stylePreset: string): StylePresetConfig {
  const resolved = STYLE_PRESET_ALIASES[stylePreset] || stylePreset;
  return STYLE_PRESETS[resolved] || STYLE_PRESETS.news_broadcast;
}

const IMAGE_SYSTEM_PROMPT_CORE = `You are generating slide images for a local business & culture news website.
Interpret the USER prompt as slide composition instructions.
- Main visual: an illustration-like hero depiction (no people).
- Info block: if it mentions map/chart/diagram, render it as a simplified graphic.
- Text: include readable text only if specified in the USER prompt; keep it short and legible.
Avoid photorealistic or photographic rendering. Do not use photos or camera-like realism.
Do not add page titles, headers, labels, or editorial captions unless the USER explicitly requests them.
Do not generate generic labels like "Editorial infographic" or site/category titles.
Respect the requested layout and any specified info-block count.
Only use information implied by the USER prompt; do not add extra elements.
No people, no faces, no logos, no watermarks.
`;

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
  const styleConfig = getStylePreset('news_broadcast');
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
  const negativeRaw = normalizeNegativePrompt(prompt.negativePrompt || styleConfig.negative);
  const strictlyAvoidLine = negativeRaw ? `Strictly avoid: ${negativeRaw}` : '';

  return [
    `SYSTEM:\n${IMAGE_SYSTEM_PROMPT_CORE}`,
    `Style:\n${styleLines}`,
    `Constraints:\n${constraintsLine}`,
    strictlyAvoidLine,
    `USER:\n${prompt.prompt}`,
  ]
    .filter((part) => part && part.length > 0)
    .join('\n\n');
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
    console.log('[image:generate] Project path:', projectPath);

    const genAI = new GoogleGenerativeAI(apiKey);
    const { imageModel, imageResolution } = await readImageGenerationSettings();

    // 設定で選択された画像生成モデルを使用
    const model = genAI.getGenerativeModel({
      model: imageModel,
    });

    const enhancedPrompt = buildImagePromptText(prompt, imageResolution);

    const imageId = crypto.randomUUID();
    const dimensions = getDimensions(prompt.aspectRatio, imageResolution);

    console.log('[image:generate] Starting image generation with prompt:', enhancedPrompt);

    const response = await withRetry(async () => {
      return model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: enhancedPrompt }],
        }],
      });
    });

    console.log('[image:generate] Response received');

    // レスポンスから画像データを抽出
    const result = response.response;
    console.log('[image:generate] Candidates:', JSON.stringify(result.candidates?.length));
    const parts = result.candidates?.[0]?.content?.parts;
    console.log('[image:generate] Parts:', JSON.stringify(parts?.map(p => ({ hasInlineData: !!p.inlineData, text: p.text?.substring(0, 50) }))));

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
    console.log('[image:generateBatch] Project path:', projectPath);

    const genAI = new GoogleGenerativeAI(apiKey);
    const { imageModel, imageResolution } = await readImageGenerationSettings();

    // 設定で選択された画像生成モデルを使用
    const model = genAI.getGenerativeModel({
      model: imageModel,
    });

    console.log('[image:generateBatch] Starting batch generation for', prompts.length, 'prompts');

    const settled = await Promise.all(
      prompts.map(async (prompt, index) => {
        try {
          const enhancedPrompt = buildImagePromptText(prompt, imageResolution);

          console.log(
            `[image:generateBatch] Generating image ${index + 1}/${prompts.length}:`,
            enhancedPrompt.substring(0, 100)
          );

          const imageId = crypto.randomUUID();
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

          console.log(`[image:generateBatch] Response received for image ${index + 1}`);

          const result = response.response;
          const parts = result.candidates?.[0]?.content?.parts;
          console.log(
            `[image:generateBatch] Parts for image ${index + 1}:`,
            JSON.stringify(parts?.map((p) => ({ hasInlineData: !!p.inlineData })))
          );

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
      console.error('Failed to delete image:', error);
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

    const imageId = crypto.randomUUID();
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
