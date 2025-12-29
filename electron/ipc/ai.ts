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
        model: 'gpt-5.2',
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
      'Japanese TV news infographic, 16:9, clean, minimal, vector-like, broadcast quality',
    colorPalette: 'cool blue/gray base with subtle cyan accents, low saturation',
    lighting: 'neutral matte lighting, low contrast',
    background: 'subtle gradient with thin grid lines and soft vignette',
    density: 'medium',
    layoutVariants: {
      dataAndLocation: 'top header band (empty), left data panel, right map panel',
      dataOnly: 'top header band (empty), left data panel, right diagram panel',
      locationOnly: 'top header band (empty), left map panel, right diagram panel',
      general: 'top header band (empty), center diagram panel',
    },
    negative:
      'no people, no faces, no anchors, no reporters, no cameras, no microphones, no interviews, no logos, no watermark, no readable text, no show titles, no station names, no program names',
  },
  documentary: {
    id: 'documentary',
    baseStyle:
      'Documentary-style news infographic, 16:9, clean, semi-realistic, broadcast quality',
    colorPalette: 'cool gray base with muted teal accents, natural tone',
    lighting: 'soft neutral lighting, slightly cinematic',
    background: 'subtle texture with light grain, restrained gradients',
    density: 'medium',
    layoutVariants: {
      dataAndLocation: 'top header band (empty), left data panel, right map panel',
      dataOnly: 'top header band (empty), left data panel, right diagram panel',
      locationOnly: 'top header band (empty), left map panel, right diagram panel',
      general: 'top header band (empty), center diagram panel',
    },
    negative:
      'no people, no faces, no anchors, no reporters, no logos, no watermark, no readable text, no show titles, no station names, no program names',
  },
  infographic: {
    id: 'infographic',
    baseStyle:
      'High-clarity infographic, 16:9, crisp vector look, balanced grid, broadcast quality',
    colorPalette: 'blue/gray base with clean cyan accents, flat tones',
    lighting: 'flat neutral lighting, minimal shadows',
    background: 'light grid background, clean white space',
    density: 'high',
    layoutVariants: {
      dataAndLocation: 'top header band (empty), left data panel, right map panel',
      dataOnly: 'top header band (empty), left data panel, right diagram panel',
      locationOnly: 'top header band (empty), left map panel, right diagram panel',
      general: 'top header band (empty), center diagram panel',
    },
    negative: 'no people, no faces, no logos, no watermark, no readable text, no show titles, no station names, no program names',
  },
  photorealistic: {
    id: 'photorealistic',
    baseStyle:
      'Photorealistic-style news graphic, 16:9, clean, professional broadcast look',
    colorPalette: 'cool blue/gray with subtle cyan accents, realistic tones',
    lighting: 'soft neutral lighting, realistic shading',
    background: 'soft gradient with minimal texture',
    density: 'medium',
    layoutVariants: {
      dataAndLocation: 'top header band (empty), left data panel, right map panel',
      dataOnly: 'top header band (empty), left data panel, right diagram panel',
      locationOnly: 'top header band (empty), left map panel, right diagram panel',
      general: 'top header band (empty), center diagram panel',
    },
    negative: 'no people, no faces, no logos, no watermark, no readable text, no show titles, no station names, no program names',
  },
  illustration: {
    id: 'illustration',
    baseStyle:
      'Illustrative news infographic, 16:9, clean, minimal, flat illustration, broadcast quality',
    colorPalette: 'cool blue/gray with cyan accents, flat colors',
    lighting: 'flat neutral lighting, minimal shadows',
    background: 'subtle gradient with light grid pattern',
    density: 'medium',
    layoutVariants: {
      dataAndLocation: 'top header band (empty), left data panel, right map panel',
      dataOnly: 'top header band (empty), left data panel, right diagram panel',
      locationOnly: 'top header band (empty), left map panel, right diagram panel',
      general: 'top header band (empty), center diagram panel',
    },
    negative: 'no people, no faces, no logos, no watermark, no readable text, no show titles, no station names, no program names',
  },
};

const STYLE_PRESET_ALIASES: Record<string, string> = {
  news_panel: 'news_broadcast',
};

function getStylePreset(stylePreset: string): StylePresetConfig {
  const resolved = STYLE_PRESET_ALIASES[stylePreset] || stylePreset;
  return STYLE_PRESETS[resolved] || STYLE_PRESETS.news_broadcast;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => normalizeString(item))
    .filter((item) => item.length > 0);
  return items.slice(0, limit);
}

function pickLayoutVariant(style: StylePresetConfig, hasData: boolean, hasLocation: boolean): string {
  if (hasData && hasLocation) return style.layoutVariants.dataAndLocation;
  if (hasData) return style.layoutVariants.dataOnly;
  if (hasLocation) return style.layoutVariants.locationOnly;
  return style.layoutVariants.general;
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
      const metric = normalizeString((fact as { metric?: unknown }).metric);
      if (!metric) return null;
      const directionRaw = normalizeString((fact as { direction?: unknown }).direction);
      const direction =
        directionRaw === 'increase' ||
        directionRaw === 'decrease' ||
        directionRaw === 'stable' ||
        directionRaw === 'comparison'
          ? directionRaw
          : 'unknown';
      const valueStr = normalizeString((fact as { value?: unknown }).value);
      const unit = normalizeString((fact as { unit?: unknown }).unit);
      const timeframe = normalizeString((fact as { timeframe?: unknown }).timeframe);
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

function describeQuantFacts(facts: QuantFact[]): string {
  return facts
    .map((fact) => {
      const parts: string[] = [];
      parts.push(fact.metric);
      if (fact.direction && fact.direction !== 'unknown') {
        const directionWord =
          fact.direction === 'increase'
            ? 'increasing'
            : fact.direction === 'decrease'
              ? 'decreasing'
              : fact.direction === 'stable'
                ? 'stable'
                : 'comparison';
        parts.push(`(${directionWord})`);
      }
      if (fact.value) {
        parts.push(`value ${fact.value}${fact.unit || ''}`);
      }
      if (fact.timeframe) {
        parts.push(`timeframe ${fact.timeframe}`);
      }
      return parts.join(' ');
    })
    .join('; ');
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

const ELEMENT_TYPE_LABELS: Record<AllowedElementType, string> = {
  barChart: 'bar chart',
  lineChart: 'line chart',
  areaChart: 'area chart',
  pieChart: 'pie chart',
  map: 'simplified map',
  diagram: 'diagram',
  iconCluster: 'icon cluster',
  abstractPattern: 'abstract pattern',
  flowArrows: 'flow arrows',
  timeline: 'timeline',
};

const DATA_ELEMENT_TYPES = new Set<AllowedElementType>([
  'barChart',
  'lineChart',
  'areaChart',
  'pieChart',
  'timeline',
]);

const LOCATION_ELEMENT_TYPES = new Set<AllowedElementType>(['map']);

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
  return map[normalized] || null;
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
      const source = normalizeString((slot as { source?: unknown }).source);
      return {
        slot: slotName,
        elementType,
        source: source || undefined,
      } as VisualSlot;
    })
    .filter((item): item is VisualSlot => item !== null);
  return items.slice(0, limit);
}

// 画像プロンプト生成ハンドラ
ipcMain.handle(
  'ai:generateImagePrompts',
  async (
    _,
    parts: GeneratedPart[],
    article: Article,
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
    const styleConfig = getStylePreset(stylePreset);

    const partsDescription = parts.map((p, i) => `パート${i + 1}: ${p.title}`).join('\n');
    const articleText = `${article.title}\n${article.source ?? ''}\n${article.bodyText}`.trim();
    const articleContext = `タイトル: ${article.title}\n${article.source ? `出典: ${article.source}` : ''}\n本文:\n${article.bodyText}`;

    const response = await withRetry(async () => {
      return openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [
          {
            role: 'system',
            content: `あなたは日本の報道番組向けインフォグラフィックの仕様抽出担当です。
与えられた記事本文から「本文に書かれている事実」だけを抽出し、画像生成仕様をJSONで出力します。

重要なルール:
- 本文にない情報は絶対に追加しない（推測・補完禁止）
- 固有名詞・地名・数値は本文の表現をそのまま使う（言い換え禁止）
- 本文に書かれている語句のみを使い、本文に無い語句は出力しない
- 架空のニュース番組名・放送局名・番組タイトルは絶対に出力しない（本文にあっても除外）
- 人物、顔、キャスター、記者、インタビューは絶対に含めない
- 出力はJSONのみ`,
          },
          {
            role: 'user',
            content: `以下の「記事全文」と「パート見出し」を基に、画像生成に必要な「抽出情報」をJSONで出力してください。
抽出は必ず記事本文にある語のみを使い、本文に無い情報は空にしてください。

## 記事全文
${articleContext}

## パート見出し
${partsDescription}

## 要件
1. topic/entities/locations/quantFacts/visualSlots は記事本文にある語だけを使う
2. 数値・単位・期間が記事本文に無い場合は空文字にする
3. 本文に記載が無い項目は空配列または空文字で出力する
4. 架空のニュース番組名・放送局名・番組タイトルは出力しない（本文にあっても除外）
5. visualSlots.elementType は以下の固定候補のみ:
   - barChart, lineChart, areaChart, pieChart, map, diagram, iconCluster, abstractPattern, flowArrows, timeline
6. visualSlots.slot は以下の固定候補のみ:
   - left, right, center, top, bottom
7. visualSlots.source は記事本文からの短い引用（抜き出し）にする

## 出力形式
以下のJSON形式で出力してください。partIndexは0から始まる数値です（パート1 = partIndex:0、パート2 = partIndex:1、...）：

{
  "prompts": [
    {
      "partIndex": 0,
      "topic": "本文にある主題を短く",
      "entities": ["本文にある名詞のみ"],
      "locations": ["本文にある地名のみ"],
      "quantFacts": [
        { "metric": "本文にある指標名", "direction": "increase|decrease|stable|comparison|unknown", "value": "数値", "unit": "単位", "timeframe": "期間" }
      ],
      "visualSlots": [
        { "slot": "left", "elementType": "barChart", "source": "本文からの抜き出し" }
      ]
    }
  ]
}

JSONのみを出力してください。`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AIからの応答が空でした');
    }

    const parsed = JSON.parse(content);
    const now = new Date().toISOString();

    return parsed.prompts.map((p: Record<string, unknown>, index: number) => {
      // AIが1始まりのインデックスを返した場合のフォールバック
      let partIndex = typeof p.partIndex === 'number' ? p.partIndex : index;
      if (partIndex >= parts.length && partIndex > 0) {
        partIndex -= 1;
      }
      if (partIndex < 0 || partIndex >= parts.length) {
        partIndex = index;
      }

      const part = parts[partIndex] || parts[index];
      const sourceText = articleText;

      const rawTopic = normalizeString(p.topic ?? p.subject);
      const topic =
        rawTopic && sourceText.includes(rawTopic) ? rawTopic : '';

      const entities = normalizeStringArray(p.entities, 6).filter((item) => sourceText.includes(item));
      const locations = normalizeStringArray(p.locations, 4).filter((item) => sourceText.includes(item));

      const quantFactsRaw = normalizeQuantFacts(p.quantFacts, 4);
      const quantFacts = quantFactsRaw.filter((fact) => {
        return (
          (fact.metric && sourceText.includes(fact.metric)) ||
          (fact.value && sourceText.includes(fact.value)) ||
          (fact.timeframe && sourceText.includes(fact.timeframe))
        );
      });

      const visualSlotsRaw = normalizeVisualSlots(p.visualSlots, 4);
      const visualSlots = visualSlotsRaw
        .map((slot) => {
          const nextSource =
            slot.source && sourceText.includes(slot.source) ? slot.source : undefined;
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

      const resolvedSlots: VisualSlot[] = visualSlots.length > 0
        ? visualSlots
        : (() => {
            if (hasData && hasLocation) {
              return [
                { slot: 'left', elementType: 'barChart' },
                { slot: 'right', elementType: 'map' },
              ];
            }
            if (hasData) {
              return [
                { slot: 'left', elementType: 'barChart' },
                { slot: 'right', elementType: 'diagram' },
              ];
            }
            if (hasLocation) {
              return [
                { slot: 'left', elementType: 'map' },
                { slot: 'right', elementType: 'diagram' },
              ];
            }
            return [{ slot: 'center', elementType: 'abstractPattern' }];
          })();

      const layout = pickLayoutVariant(styleConfig, hasData, hasLocation);
      const slotDescriptions = resolvedSlots
        .map((slot) => {
          const label = ELEMENT_TYPE_LABELS[slot.elementType];
          if (slot.source) {
            return `${slot.slot} panel: ${label} based on "${slot.source}"`;
          }
          return `${slot.slot} panel: ${label}`;
        })
        .join('; ');

      const detailLines: string[] = [];
      if (topic) {
        detailLines.push(`Represent the topic: ${topic}.`);
      }
      if (entities.length > 0) {
        detailLines.push(`Include simplified icons for ${entities.join(', ')}.`);
      }
      if (locations.length > 0) {
        detailLines.push(`Highlight locations: ${locations.join(', ')} (no labels).`);
      }
      if (quantFacts.length > 0) {
        detailLines.push(`Data cues: ${describeQuantFacts(quantFacts)}.`);
      }
      if (slotDescriptions) {
        detailLines.push(`Panels: ${slotDescriptions}.`);
      }

      const promptParts = [
        styleConfig.baseStyle,
        `Color palette: ${styleConfig.colorPalette}.`,
        `Lighting: ${styleConfig.lighting}.`,
        `Background: ${styleConfig.background}.`,
        `Layout: ${layout}.`,
        `Information density: ${styleConfig.density}.`,
        ...detailLines,
        'No readable text.',
        'No show titles, station names, or program names.',
      ];

      const finalPrompt = promptParts.join(' ');

      return {
        id: crypto.randomUUID(),
        partId: part?.id || '',
        stylePreset: styleConfig.id,
        prompt: finalPrompt,
        negativePrompt: styleConfig.negative,
        aspectRatio: '16:9' as const,
        version: 1,
        createdAt: now,
      };
    });
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
        model: 'gpt-5.2',
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
