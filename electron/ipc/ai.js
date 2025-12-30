import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod/v3';
// シークレットファイルのパス
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');
// APIキーを読み込み
async function readApiKey(service) {
    if (!safeStorage.isEncryptionAvailable()) {
        return null;
    }
    try {
        const secretsPath = getSecretsPath();
        const encryptedData = await fs.readFile(secretsPath);
        const decrypted = safeStorage.decryptString(encryptedData);
        const secrets = JSON.parse(decrypted);
        return secrets[service] || null;
    }
    catch {
        return null;
    }
}
// 指数バックオフ + ジッター付きリトライ
async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
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
function mapOpenAIUsage(usage, model) {
    if (!usage)
        return null;
    return {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        model,
    };
}
// スクリプト生成プロンプト
function createScriptGenerationPrompt(article, options) {
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
ipcMain.handle('ai:generateScript', async (_, article, options = {}) => {
    const apiKey = await readApiKey('openai');
    if (!apiKey) {
        throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }
    const openai = new OpenAI({ apiKey });
    const response = await withRetry(async () => {
        return openai.chat.completions.parse({
            model: 'gpt-5.2',
            messages: [
                {
                    role: 'system',
                    content: 'あなたは報道動画のスクリプトライターです。与えられた記事を読みやすいナレーションスクリプトに変換します。',
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
    const parts = parsed.parts.map((part, index) => ({
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
    }));
    return {
        parts,
        usage: mapOpenAIUsage(response.usage, response.model),
    };
});
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
    prompts: z.array(z.object({
        topic: z.string(),
        entities: z.array(z.string()),
        locations: z.array(z.string()),
        quantFacts: z.array(QuantFactSchema),
        visualSlots: z.array(VisualSlotSchema),
        heroSubject: z.string(),
        heroSetting: z.string(),
        compositionNote: z.string(),
    })),
});
const STYLE_PRESETS = {
    news_broadcast: {
        id: 'news_broadcast',
        baseStyle: 'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
        colorPalette: 'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
        lighting: 'soft natural light, matte, low contrast',
        background: 'white to very light gray, minimal, no heavy grid, no vignette',
        density: 'low',
        layoutVariants: {
            dataAndLocation: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”と地図“風”を使う',
            dataOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”を使う',
            locationOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら地図“風”を使う',
            general: '余白を確保し、内容に合わせて情報領域を自由に構成（カード/帯/一覧/図などを柔軟に）',
        },
        negative: '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
    },
    documentary: {
        id: 'documentary',
        baseStyle: 'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
        colorPalette: 'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
        lighting: 'soft natural light, matte, low contrast',
        background: 'white to very light gray, minimal, no heavy grid, no vignette',
        density: 'low',
        layoutVariants: {
            dataAndLocation: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”と地図“風”を使う',
            dataOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”を使う',
            locationOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら地図“風”を使う',
            general: '余白を確保し、内容に合わせて情報領域を自由に構成（カード/帯/一覧/図などを柔軟に）',
        },
        negative: '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
    },
    infographic: {
        id: 'infographic',
        baseStyle: 'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
        colorPalette: 'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
        lighting: 'soft natural light, matte, low contrast',
        background: 'white to very light gray, minimal, no heavy grid, no vignette',
        density: 'low',
        layoutVariants: {
            dataAndLocation: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”と地図“風”を使う',
            dataOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”を使う',
            locationOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら地図“風”を使う',
            general: '余白を確保し、内容に合わせて情報領域を自由に構成（カード/帯/一覧/図などを柔軟に）',
        },
        negative: '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
    },
    photorealistic: {
        id: 'photorealistic',
        baseStyle: 'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
        colorPalette: 'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
        lighting: 'soft natural light, matte, low contrast',
        background: 'white to very light gray, minimal, no heavy grid, no vignette',
        density: 'low',
        layoutVariants: {
            dataAndLocation: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”と地図“風”を使う',
            dataOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”を使う',
            locationOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら地図“風”を使う',
            general: '余白を確保し、内容に合わせて情報領域を自由に構成（カード/帯/一覧/図などを柔軟に）',
        },
        negative: '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
    },
    illustration: {
        id: 'illustration',
        baseStyle: 'Editorial infographic for a local news website, 16:9, clean layout, generous whitespace, illustration-like main visual with flexible info blocks, no photorealism',
        colorPalette: 'white/light gray base, dark navy/charcoal structure, one subtle cyan/teal accent, low saturation',
        lighting: 'soft natural light, matte, low contrast',
        background: 'white to very light gray, minimal, no heavy grid, no vignette',
        density: 'low',
        layoutVariants: {
            dataAndLocation: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”と地図“風”を使う',
            dataOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら図表“風”を使う',
            locationOnly: '余白を確保し、内容に合わせて情報領域を自由に構成。必要なら地図“風”を使う',
            general: '余白を確保し、内容に合わせて情報領域を自由に構成（カード/帯/一覧/図などを柔軟に）',
        },
        negative: '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
    },
};
const STYLE_PRESET_ALIASES = {
    news_panel: 'news_broadcast',
};
function getStylePreset(stylePreset) {
    const resolved = STYLE_PRESET_ALIASES[stylePreset] || stylePreset;
    return STYLE_PRESETS[resolved] || STYLE_PRESETS.news_broadcast;
}
function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
const NOISE_LINE_PATTERNS = [
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
function isNoiseLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return false;
    if (NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed)))
        return true;
    const hasPathLike = /[\\/]/.test(trimmed);
    if (hasPathLike) {
        const extPattern = new RegExp(`\\.(${NOISE_FILE_EXTENSIONS.join('|')})\\b`, 'i');
        if (extPattern.test(trimmed))
            return true;
    }
    return false;
}
function sanitizeArticleText(text) {
    if (!text)
        return '';
    const lines = text.split(/\r?\n/);
    const filtered = lines.filter((line) => !isNoiseLine(line));
    return filtered.join('\n').trim();
}
function normalizeStringArray(value, limit) {
    if (!Array.isArray(value))
        return [];
    const items = value
        .map((item) => normalizeString(item))
        .filter((item) => item.length > 0);
    return items.slice(0, limit);
}
function pickLayoutVariant(style, hasData, hasLocation) {
    if (hasData && hasLocation)
        return style.layoutVariants.dataAndLocation;
    if (hasData)
        return style.layoutVariants.dataOnly;
    if (hasLocation)
        return style.layoutVariants.locationOnly;
    return style.layoutVariants.general;
}
function normalizeQuantFacts(value, limit) {
    if (!Array.isArray(value))
        return [];
    const items = value
        .map((fact) => {
        if (!fact || typeof fact !== 'object')
            return null;
        const metric = normalizeString(fact.metric);
        if (!metric)
            return null;
        const directionRaw = normalizeString(fact.direction);
        const direction = directionRaw === 'increase' ||
            directionRaw === 'decrease' ||
            directionRaw === 'stable' ||
            directionRaw === 'comparison'
            ? directionRaw
            : 'unknown';
        const valueStr = normalizeString(fact.value);
        const unit = normalizeString(fact.unit);
        const timeframe = normalizeString(fact.timeframe);
        return {
            metric,
            direction,
            value: valueStr,
            unit,
            timeframe,
        };
    })
        .filter((item) => item !== null);
    return items.slice(0, limit);
}
function describeQuantFactsJa(facts) {
    return facts
        .map((fact) => {
        const parts = [];
        parts.push(fact.metric);
        if (fact.direction && fact.direction !== 'unknown') {
            const directionWord = fact.direction === 'increase'
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
];
const ELEMENT_TYPE_LABELS_JA = {
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
const SLOT_LABELS_JA = {
    left: '左',
    right: '右',
    center: '中央',
    top: '上',
    bottom: '下',
};
const DATA_ELEMENT_TYPES = new Set([
    'barChart',
    'lineChart',
    'areaChart',
    'pieChart',
    'timeline',
]);
const LOCATION_ELEMENT_TYPES = new Set(['map']);
const CHART_LIKE_TYPES = new Set([
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
function containsForbiddenTerm(value) {
    return FORBIDDEN_TERMS.some((term) => value.includes(term));
}
function normalizeExtractedText(value, sourceText) {
    const raw = normalizeString(value);
    if (!raw)
        return '';
    if (!sourceText.includes(raw))
        return '';
    if (containsForbiddenTerm(raw))
        return '';
    return raw;
}
function normalizeCompositionNote(value) {
    const raw = normalizeString(value);
    if (!raw)
        return '';
    const trimmed = raw.slice(0, 160);
    if (containsForbiddenTerm(trimmed))
        return '';
    if (isNoiseLine(trimmed))
        return '';
    return trimmed;
}
const ALLOWED_SLOT_NAMES = new Set(['left', 'right', 'center', 'top', 'bottom']);
function normalizeElementType(value) {
    const raw = normalizeString(value).toLowerCase();
    if (!raw)
        return null;
    const normalized = raw.replace(/[_\s-]/g, '');
    const map = {
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
function normalizeSlotName(value) {
    const name = normalizeString(value).toLowerCase();
    if (!name || !ALLOWED_SLOT_NAMES.has(name))
        return null;
    return name;
}
function normalizeVisualSlots(value, limit) {
    if (!Array.isArray(value))
        return [];
    const items = value
        .map((slot) => {
        if (!slot || typeof slot !== 'object')
            return null;
        const slotName = normalizeSlotName(slot.slot);
        const elementType = normalizeElementType(slot.elementType);
        if (!slotName || !elementType)
            return null;
        const source = normalizeString(slot.source);
        return {
            slot: slotName,
            elementType,
            source: source || undefined,
        };
    })
        .filter((item) => item !== null);
    return items.slice(0, limit);
}
// 画像プロンプト生成ハンドラ
ipcMain.handle('ai:generateImagePrompts', async (_, parts, article, stylePreset) => {
    const apiKey = await readApiKey('openai');
    if (!apiKey) {
        throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }
    const openai = new OpenAI({ apiKey });
    void stylePreset;
    const styleConfig = getStylePreset('news_broadcast');
    const partsDescription = parts.map((p, i) => `パート${i + 1}: ${p.title}`).join('\n');
    const cleanedBodyText = sanitizeArticleText(article.bodyText ?? '');
    const bodyTextForPrompt = cleanedBodyText || article.bodyText || '';
    const articleText = `${article.title}\n${article.source ?? ''}\n${bodyTextForPrompt}`.trim();
    const articleContext = `タイトル: ${article.title}\n${article.source ? `出典: ${article.source}` : ''}\n本文:\n${bodyTextForPrompt}`;
    const response = await withRetry(async () => {
        return openai.chat.completions.create({
            model: 'gpt-5.2',
            messages: [
                {
                    role: 'system',
                    content: `あなたは「記事本文から、画像生成に必要な情報だけを抽出して仕様化する」担当です。
入力は「記事全文」と「パート見出し」です。出力は指定スキーマの JSON オブジェクトのみです（説明文・Markdown・前置き禁止）。

目的:
- 各パートごとに、本文に書かれた事実にもとづき topic / entities / locations / quantFacts / visualSlots を作成し、
  さらに主ビジュアルの要素（heroSubject/heroSetting）と構図メモ（compositionNote）を短く作成する。

厳守ルール（本文由来フィールド）:
1) 推測・補完・一般知識の追加は禁止。本文に書かれていない内容は出力しない。
2) 次のフィールドに入れる文字列は、必ず「記事本文に含まれる表現」をそのまま抜き出す（言い換え禁止）。
   - topic
   - entities の各要素
   - locations の各要素
   - quantFacts の各要素：metric / value / unit / timeframe
   - visualSlots の各要素：source
   - heroSubject
   - heroSetting
   ※抜き出しできない場合は "" または [] にする。
3) 次のフィールドは制御用の固定値なので、本文に存在しなくても出力してよい（候補以外は出さない）。
   - quantFacts.direction（increase|decrease|stable|comparison|unknown）
   - visualSlots.elementType（指定候補のみ）
   - visualSlots.slot（指定候補のみ）
   - JSONのキー名
4) 番組・放送に関する名称（番組名、局名、番組タイトル等）に該当する語は出力しない（本文にあっても除外）。
5) 人物・顔・キャスター・記者・インタビューを想起させる要素は出力しない（entities にも入れない）。
6) 入力に混入し得るノイズ（ファイルパス、URL、コード断片、ログ、設定文、署名、UI文言など）は本文事実ではないため無視し、
   topic/entities/locations/source/heroSubject/heroSetting に絶対に含めない。

compositionNote（構図メモ）の制約:
- compositionNote は 1〜2文の短文。
- レイアウトや情報の見せ方を自由に提案する（例: 左右分割/上下分割/比較/タイムライン/フロー/箇条書き/カード/図など）。
- 新しい事実・固有名詞・数字は追加しない。内容を指す場合は本文からの語句を引用して示す。

抽出の目安:
- entities は最大5件、locations は最大3件、quantFacts は最大3件。
- visualSlots は各パート 0〜3件。source は本文からの短い抜き出し（長文禁止）。

配列順:
- prompts 配列の順番は、パート見出しの順番と一致させる。

最終チェック:
- topic/entities/locations/metric/value/unit/timeframe/source/heroSubject/heroSetting が本文中に存在しない場合は削除または空にする。
- JSON以外を絶対に出力しない。`,
                },
                {
                    role: 'user',
                    content: `以下の「記事全文」と「パート見出し」を基に、画像生成に必要な抽出情報を JSON で出力してください。
本文由来フィールドは必ず本文からの抜き出しにしてください。本文に無い情報は空にしてください。
入力にノイズ（ファイルパス、URL、コード断片、ログ等）が混ざる場合は無視してください。

## 記事全文
${articleContext}

## パート見出し
${partsDescription}

## 要件
- topic/entities/locations/quantFacts(metric,value,unit,timeframe)/visualSlots.source/heroSubject/heroSetting は本文からの抜き出しのみ
- direction/elementType/slot は固定候補から選ぶ
- compositionNote は1〜2文で、レイアウト/情報の見せ方を自由に提案（新しい事実は追加しない）
- prompts 配列の順番はパート見出しの順番と一致させる

## 出力形式（JSONのみ）
{
  "prompts": [
    {
      "topic": "",
      "entities": [],
      "locations": [],
      "quantFacts": [
        { "metric": "", "direction": "unknown", "value": "", "unit": "", "timeframe": "" }
      ],
      "visualSlots": [
        { "slot": "left", "elementType": "diagram", "source": "" }
      ],
      "heroSubject": "",
      "heroSetting": "",
      "compositionNote": ""
    }
  ]
}

JSONのみを出力してください。`,
                },
            ],
            response_format: zodResponseFormat(ImagePromptExtractionSchema, 'image_prompt_extraction'),
            temperature: 0.3,
        });
    });
    const message = response.choices[0]?.message;
    if (!message) {
        throw new Error('AIからの応答が空でした');
    }
    if (message.refusal) {
        throw new Error(`AIが拒否しました: ${message.refusal}`);
    }
    const parsed = message.parsed ?? null;
    const fallbackParsed = !parsed && message.content ? JSON.parse(message.content) : null;
    const resolvedParsed = parsed ?? fallbackParsed;
    if (!resolvedParsed) {
        throw new Error('AIからの応答が空でした');
    }
    const now = new Date().toISOString();
    const promptsArray = Array.isArray(resolvedParsed.prompts) ? resolvedParsed.prompts : [];
    return parts.map((part, index) => {
        const candidate = promptsArray[index];
        const p = candidate && typeof candidate === 'object'
            ? candidate
            : {};
        const sourceText = articleText;
        const rawTopic = normalizeString(p.topic ?? p.subject);
        const topic = rawTopic && sourceText.includes(rawTopic) && !containsForbiddenTerm(rawTopic) ? rawTopic : '';
        const entities = normalizeStringArray(p.entities, 5).filter((item) => sourceText.includes(item) && !containsForbiddenTerm(item));
        const locations = normalizeStringArray(p.locations, 3).filter((item) => sourceText.includes(item));
        const quantFactsRaw = normalizeQuantFacts(p.quantFacts, 3);
        const quantFacts = quantFactsRaw.filter((fact) => {
            return ((fact.metric && sourceText.includes(fact.metric)) ||
                (fact.value && sourceText.includes(fact.value)) ||
                (fact.timeframe && sourceText.includes(fact.timeframe)));
        });
        const visualSlotsRaw = normalizeVisualSlots(p.visualSlots, 3);
        const visualSlots = visualSlotsRaw
            .map((slot) => {
            const nextSource = slot.source && sourceText.includes(slot.source) ? slot.source : undefined;
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
        const hasLocation = locations.length > 0 || visualSlots.some((slot) => LOCATION_ELEMENT_TYPES.has(slot.elementType));
        const resolvedSlots = visualSlots;
        const layout = pickLayoutVariant(styleConfig, hasData, hasLocation);
        const heroSubject = normalizeExtractedText(p.heroSubject, sourceText);
        const heroSetting = normalizeExtractedText(p.heroSetting, sourceText);
        const compositionNote = normalizeCompositionNote(p.compositionNote);
        const layoutInstruction = compositionNote
            ? '構図メモを優先し、情報の見せ方は自由に設計する'
            : layout;
        const mainVisualParts = [];
        if (heroSubject)
            mainVisualParts.push(heroSubject);
        if (heroSetting)
            mainVisualParts.push(heroSetting);
        const mainVisualLine = mainVisualParts.length > 0
            ? `メインビジュアル（イラスト風・人物なし）: ${mainVisualParts.join(' / ')}。`
            : topic
                ? `メインビジュアル（イラスト風・人物なし）: ${topic}。`
                : 'メインビジュアル（イラスト風・人物なし）: 文字なしで抽象的に表現。';
        const slotDescriptions = resolvedSlots.map((slot) => {
            const label = ELEMENT_TYPE_LABELS_JA[slot.elementType];
            const slotLabel = SLOT_LABELS_JA[slot.slot];
            const sourceLabel = slot.source ? `（「${slot.source}」に基づく）` : '';
            const qualifier = CHART_LIKE_TYPES.has(slot.elementType)
                ? '（簡略・アイコン風・ラベルなし）'
                : '（簡略）';
            return `${slotLabel}に${label}${sourceLabel}${qualifier}を配置してもよい`;
        });
        const slotLine = slotDescriptions.length > 0 ? `表示候補: ${slotDescriptions.join(' / ')}` : '';
        const optionalHints = [];
        if (slotDescriptions.length === 0) {
            if (hasData)
                optionalHints.push('データは図表風で示してよい');
            if (hasLocation)
                optionalHints.push('場所は地図風で示してよい');
        }
        const optionalLine = optionalHints.length > 0 ? `必要に応じて${optionalHints.join('、')}。` : '';
        const detailLines = [];
        if (entities.length > 0) {
            detailLines.push(`必要なら${entities.join('、')}をアイコンやシルエットで示す。`);
        }
        if (locations.length > 0) {
            detailLines.push(`必要なら場所は${locations.join('、')}を参照（ラベルなし）。`);
        }
        if (quantFacts.length > 0) {
            detailLines.push(`必要ならデータ要素: ${describeQuantFactsJa(quantFacts)}（アイコン風・ラベルなし）。`);
        }
        const promptParts = [
            `レイアウト: ${layoutInstruction}`,
            'スライド目的: 地域密着のビジネス＆カルチャーニュース向け。余白多めの編集レイアウト。',
            mainVisualLine,
            '表現はイラスト風（写真・実写は避ける）。',
            compositionNote ? `構図メモ: ${compositionNote}` : '',
            '情報の見せ方は内容に合わせて自由に設計（カード/比較/タイムライン/フロー/地図/図表/箇条書きなど）。',
            ...detailLines,
            slotLine,
            optionalLine,
            'テキストは必要に応じて短く配置してよい（見出し・要点程度）。',
        ].filter((part) => part && part.length > 0);
        const finalPrompt = promptParts.join(' ');
        return {
            id: crypto.randomUUID(),
            partId: part?.id || '',
            stylePreset: styleConfig.id,
            prompt: finalPrompt,
            negativePrompt: styleConfig.negative,
            aspectRatio: '16:9',
            version: 1,
            createdAt: now,
        };
    });
});
// コメント反映ハンドラ
ipcMain.handle('ai:applyComment', async (_, target, comment) => {
    const apiKey = await readApiKey('openai');
    if (!apiKey) {
        throw new Error('OpenAI APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    }
    const openai = new OpenAI({ apiKey });
    const systemPrompt = target.type === 'script'
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
    return {
        text: content,
        usage: mapOpenAIUsage(response.usage, response.model),
    };
});
