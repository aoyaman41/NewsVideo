import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

// シークレットファイルのパス
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');

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
  aspectRatio: '16:9' | '1:1' | '9:16';
  version: number;
  createdAt: string;
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
function getDimensions(aspectRatio: '16:9' | '1:1' | '9:16'): { width: number; height: number } {
  switch (aspectRatio) {
    case '16:9':
      return { width: 1920, height: 1080 };
    case '1:1':
      return { width: 1024, height: 1024 };
    case '9:16':
      return { width: 1080, height: 1920 };
    default:
      return { width: 1920, height: 1080 };
  }
}

function stripAspectRatioHints(prompt: string): string {
  return prompt
    .replace(/\b16:9\b|\b1:1\b|\b9:16\b/g, '')
    .replace(/,\s*,/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildAspectRatioHint(
  aspectRatio: '16:9' | '1:1' | '9:16',
  dimensions: { width: number; height: number }
): string {
  const label =
    aspectRatio === '1:1' ? 'square' : aspectRatio === '9:16' ? 'vertical' : 'horizontal';
  return `Aspect ratio: ${aspectRatio} (${label}). Target resolution: ${dimensions.width}x${dimensions.height}. Keep this aspect ratio strictly.`;
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

    // Nano Banana Pro (gemini-3-pro-image-preview) モデルを使用
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
    });

    // 日本語ニュース向けのシステム指示を追加
    const japaneseNewsContext = `日本の報道番組向けのインフォグラフィック画像を生成してください。
日本人視聴者向けのデザインで、信頼性があり、プロフェッショナルな印象を与える画像にしてください。
人物、顔、キャスター、記者は含めないでください。`;

    const imageId = crypto.randomUUID();
    const dimensions = getDimensions(prompt.aspectRatio);
    const ratioHint = buildAspectRatioHint(prompt.aspectRatio, dimensions);
    const promptText = stripAspectRatioHints(prompt.prompt);

    // スタイルプリセットを反映したプロンプトを構築
    const enhancedPrompt = `${japaneseNewsContext}\n${ratioHint}\n\n${promptText}`;

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

    // Nano Banana Pro (gemini-3-pro-image-preview) モデルを使用
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-image-preview',
    });

    console.log('[image:generateBatch] Starting batch generation for', prompts.length, 'prompts');

    // 日本語ニュース向けのシステム指示を追加（全件共通）
    const japaneseNewsContext = `日本の報道番組向けのインフォグラフィック画像を生成してください。
日本人視聴者向けのデザインで、信頼性があり、プロフェッショナルな印象を与える画像にしてください。
人物、顔、キャスター、記者は含めないでください。`;

    const settled = await Promise.all(
      prompts.map(async (prompt, index) => {
        try {
          const dimensions = getDimensions(prompt.aspectRatio);
          const ratioHint = buildAspectRatioHint(prompt.aspectRatio, dimensions);
          const promptText = stripAspectRatioHints(prompt.prompt);
          const enhancedPrompt = `${japaneseNewsContext}\n${ratioHint}\n\n${promptText}`;

          console.log(
            `[image:generateBatch] Generating image ${index + 1}/${prompts.length}:`,
            enhancedPrompt.substring(0, 100)
          );

          const imageId = crypto.randomUUID();

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
