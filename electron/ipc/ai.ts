import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import OpenAI from 'openai';

// シークレットファイルのパス
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');

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

  return `あなたは報道動画のスクリプトライターです。以下の記事を、${targetPartCount}個のパートに分割し、各パートのナレーションスクリプトを作成してください。

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

// スクリプト生成ハンドラ
ipcMain.handle(
  'ai:generateScript',
  async (_, article: Article, options: ScriptOptions = {}): Promise<GeneratedPart[]> => {
    const apiKey = await readApiKey('openai');

    if (!apiKey) {
      throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }

    const openai = new OpenAI({ apiKey });

    const response = await withRetry(async () => {
      return openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'あなたは報道動画のスクリプトライターです。与えられた記事を読みやすいナレーションスクリプトに変換します。',
          },
          {
            role: 'user',
            content: createScriptGenerationPrompt(article, options),
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AIからの応答が空でした');
    }

    const parsed = JSON.parse(content);
    const now = new Date().toISOString();

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

    return parts;
  }
);

// 画像プロンプト生成ハンドラ
ipcMain.handle(
  'ai:generateImagePrompts',
  async (
    _,
    parts: GeneratedPart[],
    stylePreset: string
  ): Promise<
    Array<{
      id: string;
      partId: string;
      stylePreset: string;
      prompt: string;
      negativePrompt: string;
      aspectRatio: '16:9';
      version: number;
      createdAt: string;
    }>
  > => {
    const apiKey = await readApiKey('openai');

    if (!apiKey) {
      throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }

    const openai = new OpenAI({ apiKey });

    const partsDescription = parts
      .map((p, i) => `パート${i + 1}: ${p.title}\nスクリプト: ${p.scriptText}`)
      .join('\n\n');

    const response = await withRetry(async () => {
      return openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `あなたは報道動画のビジュアルディレクターです。スクリプトの内容に合った画像生成プロンプトを作成します。
スタイル: ${stylePreset}`,
          },
          {
            role: 'user',
            content: `以下のスクリプトパートそれぞれに対して、画像生成AIに渡すプロンプトを作成してください。

${partsDescription}

## 要件
1. 各パートの内容を視覚的に表現する画像のプロンプトを作成してください
2. プロンプトは英語で記述してください
3. 報道番組にふさわしい、信頼性のある映像表現を心がけてください

## 出力形式
以下のJSON形式で出力してください：

{
  "prompts": [
    {
      "partIndex": 0,
      "prompt": "画像生成プロンプト（英語）",
      "negativePrompt": "除外したい要素（英語）"
    }
  ]
}

JSONのみを出力してください。`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AIからの応答が空でした');
    }

    const parsed = JSON.parse(content);
    const now = new Date().toISOString();

    return parsed.prompts.map(
      (p: { partIndex: number; prompt: string; negativePrompt: string }) => ({
        id: crypto.randomUUID(),
        partId: parts[p.partIndex]?.id || '',
        stylePreset,
        prompt: p.prompt,
        negativePrompt: p.negativePrompt || '',
        aspectRatio: '16:9' as const,
        version: 1,
        createdAt: now,
      })
    );
  }
);

// コメント反映ハンドラ
ipcMain.handle(
  'ai:applyComment',
  async (
    _,
    target: { type: 'script' | 'imagePrompt'; id: string; currentText: string },
    comment: string
  ): Promise<string> => {
    const apiKey = await readApiKey('openai');

    if (!apiKey) {
      throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }

    const openai = new OpenAI({ apiKey });

    const systemPrompt =
      target.type === 'script'
        ? 'あなたは報道動画のスクリプトエディターです。与えられたコメントに基づいてスクリプトを修正します。'
        : 'あなたは画像生成プロンプトのエディターです。与えられたコメントに基づいてプロンプトを修正します。';

    const response = await withRetry(async () => {
      return openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `以下の${target.type === 'script' ? 'スクリプト' : 'プロンプト'}を、コメントに基づいて修正してください。

## 現在の内容
${target.currentText}

## コメント（修正依頼）
${comment}

## 要件
- コメントの意図を反映した修正を行ってください
- 元の構成や意図はできるだけ維持してください
- 修正後の本文のみを出力してください（説明不要）`,
          },
        ],
        temperature: 0.7,
      });
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AIからの応答が空でした');
    }

    return content;
  }
);
