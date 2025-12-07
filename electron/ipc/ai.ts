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
        model: 'gpt-5.1',
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

// 報道スライドショー用のベーステンプレート（日本語）
const NEWS_SLIDESHOW_TEMPLATE = {
  // 共通のスタイル指示（全画像に適用）
  baseStyle: `日本の報道番組向けインフォグラフィック、シンプルで洗練されたデザイン、16:9アスペクト比、高解像度、テレビ放送品質`,
  // 共通の除外要素
  baseNegative: `人物、顔、ポートレート、ニュースキャスター、記者、カメラ、マイク、記者会見、インタビュー、漫画、アニメ、低画質、ぼやけ、テキストオーバーレイ、ウォーターマーク、ロゴ`,
  // コンテンツタイプ別のテンプレート
  contentTypes: {
    // データ・統計を表現
    data: `データ可視化、チャート、グラフ、統計インフォグラフィック、整理されたレイアウト`,
    // 場所・地理を表現
    location: `俯瞰図、衛星画像風、地理マップ、位置表示、クリーンな地図デザイン`,
    // 技術・科学を表現
    technology: `技術イラスト、設計図風、概念図、コンセプトビジュアライゼーション`,
    // 経済・ビジネスを表現
    business: `ビジネスインフォグラフィック、財務データ可視化、コーポレート抽象デザイン`,
    // 一般的なニューストピック
    general: `抽象的なニュース背景、プロフェッショナルなグラデーション、幾何学パターン`,
  },
};

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
        model: 'gpt-5.1',
        messages: [
          {
            role: 'system',
            content: `あなたは日本の報道番組向けインフォグラフィックデザイナーです。
ニュース記事の内容を視覚的に表現する「図解・イラスト」の要素を日本語で抽出します。

重要なルール:
- 人物、キャスター、記者、インタビューシーンは絶対に含めない
- 日本人視聴者向けの報道スライドショー用の背景画像・図解を想定
- 出力は全て日本語で記述`,
          },
          {
            role: 'user',
            content: `以下のスクリプトパートそれぞれに対して、ニュースの内容を図解・インフォグラフィックとして表現するための要素を日本語で抽出してください。

${partsDescription}

## 要件
1. 各パートの「主題」を視覚的に表現する要素を日本語で記述
2. 人物・顔・キャスター・記者・インタビューは絶対に含めない
3. 以下のコンテンツタイプから最適なものを選択:
   - data: 数値・統計・データを表現する場合
   - location: 地理・場所・地図を表現する場合
   - technology: 技術・科学・機器を表現する場合
   - business: 経済・ビジネス・投資を表現する場合
   - general: 上記に当てはまらない一般的なトピック

## 出力形式
以下のJSON形式で出力してください。partIndexは0から始まる数値です（パート1 = partIndex:0、パート2 = partIndex:1、...）：

{
  "prompts": [
    {
      "partIndex": 0,
      "contentType": "technology",
      "subject": "主題を表す日本語キーワード（例: AI学習システム、教育テクノロジー）",
      "visualElements": "視覚要素の日本語説明（例: タブレット端末、学習グラフ、教室のイメージ図）"
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
      (
        p: {
          partIndex: number;
          contentType: string;
          subject: string;
          visualElements: string;
        },
        index: number
      ) => {
        // AIが1始まりのインデックスを返した場合のフォールバック
        let partIndex = p.partIndex;
        if (partIndex >= parts.length && partIndex > 0) {
          partIndex = p.partIndex - 1;
        }
        if (partIndex < 0 || partIndex >= parts.length) {
          partIndex = index;
        }

        // コンテンツタイプに応じたテンプレートを取得
        const contentTypeKey = p.contentType as keyof typeof NEWS_SLIDESHOW_TEMPLATE.contentTypes;
        const contentTypeStyle =
          NEWS_SLIDESHOW_TEMPLATE.contentTypes[contentTypeKey] ||
          NEWS_SLIDESHOW_TEMPLATE.contentTypes.general;

        // テンプレート + AIが生成したコンテンツ要素を組み合わせ
        const finalPrompt = `${NEWS_SLIDESHOW_TEMPLATE.baseStyle}, ${contentTypeStyle}, ${p.subject}, ${p.visualElements}`;

        return {
          id: crypto.randomUUID(),
          partId: parts[partIndex]?.id || parts[index]?.id || '',
          stylePreset,
          prompt: finalPrompt,
          negativePrompt: NEWS_SLIDESHOW_TEMPLATE.baseNegative,
          aspectRatio: '16:9' as const,
          version: 1,
          createdAt: now,
        };
      }
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
        model: 'gpt-5.1',
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
