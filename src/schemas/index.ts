import { z } from 'zod';

// ============================================
// 基本型スキーマ
// ============================================

// 画像アセット
export const imageAssetSchema = z.object({
  id: z.string().uuid(),
  filePath: z.string(),
  sourceType: z.enum(['generated', 'imported']),
  metadata: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mimeType: z.string(),
    fileSize: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    promptId: z.string().uuid().optional(),
    tags: z.array(z.string()),
  }),
});

export type ImageAsset = z.infer<typeof imageAssetSchema>;

// 画像参照
export const imageAssetRefSchema = z.object({
  imageId: z.string().uuid(),
  displayDurationSec: z.number().positive().optional(),
});

export type ImageAssetRef = z.infer<typeof imageAssetRefSchema>;

// 画像プロンプト
export const imagePromptSchema = z.object({
  id: z.string().uuid(),
  partId: z.string().uuid(),
  stylePreset: z.string(),
  prompt: z.string().min(1, '画像プロンプトを入力してください'),
  negativePrompt: z.string().optional(),
  aspectRatio: z.enum(['16:9', '1:1', '9:16']),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export type ImagePrompt = z.infer<typeof imagePromptSchema>;

// 音声アセット
export const audioAssetSchema = z.object({
  id: z.string().uuid(),
  filePath: z.string(),
  durationSec: z.number().positive(),
  ttsEngine: z.enum(['google_tts', 'macos_tts']),
  voiceId: z.string(),
  settings: z.object({
    speakingRate: z.number().min(0.5).max(2.0),
    pitch: z.number().min(-20).max(20),
    languageCode: z.string(),
  }),
  generatedAt: z.string().datetime(),
});

export type AudioAsset = z.infer<typeof audioAssetSchema>;

// コメント
export const commentSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1, 'コメントを入力してください'),
  createdAt: z.string().datetime(),
  appliedAt: z.string().datetime().optional(),
});

export type Comment = z.infer<typeof commentSchema>;

// パート
export const partSchema = z.object({
  id: z.string().uuid(),
  index: z.number().int().nonnegative(),
  title: z.string().min(1, 'パートタイトルを入力してください'),
  summary: z.string(),
  scriptText: z.string().min(1, 'スクリプトを入力してください'),
  durationEstimateSec: z.number().nonnegative(),
  panelImages: z.array(imageAssetRefSchema),
  comments: z.array(commentSchema),
  audio: audioAssetSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  scriptGeneratedAt: z.string().datetime(),
  scriptModifiedByUser: z.boolean(),
});

export type Part = z.infer<typeof partSchema>;

// 記事
export const articleSchema = z.object({
  title: z.string().min(1, '記事タイトルを入力してください'),
  source: z.string().optional(),
  bodyText: z.string().min(1, '記事本文を入力してください'),
  importedImages: z.array(imageAssetSchema),
});

export type Article = z.infer<typeof articleSchema>;

// プロジェクトメタ情報
export const projectMetaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'プロジェクト名を入力してください'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  path: z.string(),
});

export type ProjectMeta = z.infer<typeof projectMetaSchema>;

// プロジェクト（フル）
export const projectSchema = projectMetaSchema.extend({
  schemaVersion: z.string(),
  article: articleSchema,
  parts: z.array(partSchema),
  images: z.array(imageAssetSchema),
  prompts: z.array(imagePromptSchema),
  audio: z.array(audioAssetSchema),
  thumbnail: imageAssetRefSchema.optional(),
});

export type Project = z.infer<typeof projectSchema>;

// ============================================
// フォーム入力用スキーマ
// ============================================

// 記事入力フォーム
export const articleInputSchema = z.object({
  title: z.string().min(1, '記事タイトルを入力してください').max(200, 'タイトルは200文字以内で入力してください'),
  source: z.string().max(500, '出典は500文字以内で入力してください').optional(),
  bodyText: z.string().min(10, '記事本文は10文字以上入力してください').max(50000, '記事本文は50000文字以内で入力してください'),
});

export type ArticleInput = z.infer<typeof articleInputSchema>;

// スクリプト生成オプション
export const scriptOptionsSchema = z.object({
  targetPartCount: z.number().int().min(1).max(20).optional(),
  tone: z.enum(['formal', 'casual', 'news']).optional(),
  targetDurationPerPartSec: z.number().int().min(10).max(300).optional(),
});

export type ScriptOptions = z.infer<typeof scriptOptionsSchema>;

// パート編集フォーム
export const partEditSchema = z.object({
  title: z.string().min(1, 'パートタイトルを入力してください').max(100, 'タイトルは100文字以内で入力してください'),
  scriptText: z.string().min(1, 'スクリプトを入力してください').max(5000, 'スクリプトは5000文字以内で入力してください'),
});

export type PartEdit = z.infer<typeof partEditSchema>;

// ============================================
// API レスポンス用スキーマ
// ============================================

// スクリプト生成レスポンス（AIから返される形式）
export const generatedPartSchema = z.object({
  title: z.string(),
  summary: z.string(),
  scriptText: z.string(),
  durationEstimateSec: z.number(),
});

export type GeneratedPart = z.infer<typeof generatedPartSchema>;

export const scriptGenerationResponseSchema = z.object({
  parts: z.array(generatedPartSchema),
});

export type ScriptGenerationResponse = z.infer<typeof scriptGenerationResponseSchema>;

// ============================================
// ユーティリティ関数
// ============================================

// バリデーションエラーを日本語メッセージに変換
export function formatZodError(error: z.ZodError<unknown>): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

// 新規パートを作成
export function createNewPart(index: number, data: Partial<Part> = {}): Part {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    index,
    title: data.title || `パート ${index + 1}`,
    summary: data.summary || '',
    scriptText: data.scriptText || '',
    durationEstimateSec: data.durationEstimateSec || 0,
    panelImages: data.panelImages || [],
    comments: data.comments || [],
    audio: data.audio,
    createdAt: now,
    updatedAt: now,
    scriptGeneratedAt: now,
    scriptModifiedByUser: false,
  };
}

// 新規記事を作成
export function createNewArticle(data: Partial<Article> = {}): Article {
  return {
    title: data.title || '',
    source: data.source,
    bodyText: data.bodyText || '',
    importedImages: data.importedImages || [],
  };
}

// 新規プロジェクトを作成
export function createNewProject(name: string, projectPath: string): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    path: projectPath,
    schemaVersion: '1.0.0',
    article: createNewArticle(),
    parts: [],
    images: [],
    prompts: [],
    audio: [],
    thumbnail: undefined,
  };
}
