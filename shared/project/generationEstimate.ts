import type { AppSettings } from '../settings/appSettings';
import type { UsageRecord, Project } from './schema';
import { partFreshness } from './integrity';
import { narrationCharsFor } from './narration';
import { estimateUsageCostUsd, normalizeCostRates } from '../../src/utils/cost';
import {
  getTextCompletionModelProvider,
  isOpenAIImageModel,
  isTextCompletionModel,
  type ImageSizeTier,
  type OpenAIImageModel,
} from '../constants/models';
import { getImageSizeTier, getOpenAIImageQuality } from '../constants/imageQuality';

export type GenerationOperation = 'script' | 'prompt' | 'image' | 'audio';

/** 画面に出す「多くて」の値(見込み × 1.3) */
export const ESTIMATE_UPPER_MULTIPLIER = 1.3;
/** 自動生成の予算の判定で、処理 1 件ごとに予約する額(見込み × 1.5) */
export const BUDGET_RESERVE_MULTIPLIER = 1.5;

/**
 * 見込みの計算に使う想定トークン数。2026-09 の実績(提案書 docs/missions/2026-09-26-review-cost-defaults.md §1.1)に
 * 合わせた値。見積もりは生成前の目安で、実際の金額は内容と応答によって増減する。
 */
const PROMPT_OVERHEAD_TOKENS = 1_500;
/** 日本語の文字数 → 入力トークン数(台本と画像の指示の入力は、記事本文 + 指示文) */
const CHARS_PER_INPUT_TOKEN = 1.5;
/**
 * 台本の出力トークン(1 シーンあたり)。実測 211〜436(Claude Opus 5.5、思考の深さ high を含む)。
 * 以前は 3,000 と想定していた
 */
const SCRIPT_OUTPUT_TOKENS_PER_SCENE = 450;
/**
 * 画像の指示の出力トークン(1 シーンあたり)。実測 761〜2,224、中央値 932(Claude Opus 5.5)。
 * 入力は記事本文 + 指示文(全シーンの台本を含む)
 */
const PROMPT_OUTPUT_TOKENS = 1_500;
/** 画像の生成に送る文字の入力トークン(画像の指示 1 件)。実測 949〜1,706 */
const IMAGE_INPUT_TOKENS = 1_500;
/**
 * 音声の出力トークン(読み上げる文字 1 文字あたり)。実測は約 6.1(1 秒あたり約 32 トークン × 5.3 文字/秒)。
 * 以前の式(文字数 ÷ 4 × 25)と同じ値
 */
const AUDIO_OUTPUT_TOKENS_PER_CHAR = 6.25;

type OpenAIImageQuality = 'medium' | 'high';

/**
 * GPT Image の 1 枚あたりの出力トークン(モデル × サイズ × 品質)。16:9 の大きさで考える。
 * 実測がある組み合わせ:
 * - GPT Image 2.5 Sunburst・4K・high: 3,336(2026-09、8 枚すべて同じ値)
 * - GPT Image 2・4K: 13,342(2026-04、31 枚すべて同じ値。当時は quality 指定なし(auto)で、high 相当とみなす)
 * それ以外は推定(実測がない)。OpenAI の公式の表(gpt-image-1)では、出力トークンは画素数にほぼ比例し、
 * medium は high の約 1/4(1,056 / 4,160)。これを実測の 4K・high に当てはめた。
 * - 2K(2560×1440)は 4K の 0.444 倍、Full HD 相当(1792×1008)は 0.218 倍の画素数
 * 実際に使う組み合わせは、Full HD 相当と 2K が medium、4K が high(shared/constants/imageQuality.ts)
 */
const OPENAI_IMAGE_OUTPUT_TOKENS: Record<
  OpenAIImageModel,
  Record<ImageSizeTier, Record<OpenAIImageQuality, number>>
> = {
  'gpt-image-2.5-sunburst': {
    '4K': { high: 3_336 /* 実測 */, medium: 850 /* 推定 */ },
    '2K': { high: 1_480 /* 推定 */, medium: 380 /* 推定 */ },
    '1K': { high: 730 /* 推定 */, medium: 190 /* 推定 */ },
  },
  // 実測なし。Sunburst と同じ料金・同じ世代のモデルなので、Sunburst と同じ値と推定する
  'gpt-image-2.5-flare': {
    '4K': { high: 3_336, medium: 850 },
    '2K': { high: 1_480, medium: 380 },
    '1K': { high: 730, medium: 190 },
  },
  'gpt-image-2': {
    '4K': { high: 13_342 /* 実測 */, medium: 3_390 /* 推定 */ },
    '2K': { high: 5_930 /* 推定 */, medium: 1_510 /* 推定 */ },
    '1K': { high: 2_910 /* 推定 */, medium: 740 /* 推定 */ },
  },
};

export function estimatedOpenAIImageOutputTokens(
  model: OpenAIImageModel,
  sizeTier: ImageSizeTier,
  quality: OpenAIImageQuality
): number {
  return OPENAI_IMAGE_OUTPUT_TOKENS[model][sizeTier][quality];
}

function inputTokensOf(text: string): number {
  return Math.ceil(text.length / CHARS_PER_INPUT_TOKEN) + PROMPT_OVERHEAD_TOKENS;
}

/**
 * 1 件の処理の見込み額(USD)。見積もりで、見積書ではない(トークン数は応答の前に推定している)。
 * text に渡すもの:
 * - script / prompt: 記事本文(どちらも記事全体を読んで作る)
 * - image: 画像の指示(入力は一定の値で見込むので、中身は使わない)
 * - audio: 読み上げる文
 * count は台本のシーン数(script のときだけ使う)
 */
export function estimateGenerationUsd(
  kind: GenerationOperation,
  text: string,
  settings: AppSettings,
  count = 1
): number {
  if (kind === 'audio' && settings.ttsEngine === 'macos_tts') return 0;
  const model =
    kind === 'script'
      ? settings.scriptTextModel
      : kind === 'prompt'
        ? settings.imagePromptTextModel
        : kind === 'image'
          ? settings.imageModel
          : settings.ttsModel;
  const provider = isTextCompletionModel(model)
    ? getTextCompletionModelProvider(model)
    : kind === 'image' && isOpenAIImageModel(model)
      ? 'openai'
      : 'gemini';
  // 実際に生成するサイズ区分で見積もる(Gemini は Full HD でも 2K で生成するため、2K と同じ見積もりになる)
  const imageSizeTier = getImageSizeTier(
    provider === 'openai' ? 'openai' : 'gemini',
    settings.imageResolution
  );
  const base: UsageRecord = {
    id: 'estimate',
    createdAt: '',
    provider,
    model,
    operation: kind,
    category: kind === 'image' ? 'image' : kind === 'audio' ? 'tts' : 'text',
  };
  let record: UsageRecord;
  if (kind === 'image') {
    record = {
      ...base,
      imageCount: 1,
      imageResolution: settings.imageResolution,
      imageSizeTier,
      inputTokens: IMAGE_INPUT_TOKENS,
      // Gemini は出力トークンを入れず、公式の 1 枚あたりの単価で計算する(料金表の per_image / 1 枚の単価)
      ...(provider === 'openai' && isOpenAIImageModel(model)
        ? {
            textInputTokens: IMAGE_INPUT_TOKENS,
            outputTokens: estimatedOpenAIImageOutputTokens(
              model,
              imageSizeTier,
              getOpenAIImageQuality(settings.imageResolution)
            ),
          }
        : {}),
    };
  } else if (kind === 'audio') {
    record = {
      ...base,
      inputTokens: Math.ceil(text.length / CHARS_PER_INPUT_TOKEN),
      outputTokens: Math.ceil(text.length * AUDIO_OUTPUT_TOKENS_PER_CHAR),
    };
  } else {
    record = {
      ...base,
      inputTokens: inputTokensOf(text),
      outputTokens:
        kind === 'script'
          ? SCRIPT_OUTPUT_TOKENS_PER_SCENE * Math.max(1, count)
          : PROMPT_OUTPUT_TOKENS,
    };
  }
  return estimateUsageCostUsd(record, normalizeCostRates(settings.cost));
}

export type GenerationEstimateStep = {
  kind: GenerationOperation;
  label: string;
  count: number;
  usd: number;
};

export type GenerationEstimate = {
  steps: GenerationEstimateStep[];
  /** 見込み(画面では「約 $X」) */
  usd: number;
  /** 多くてこのくらい(見込み × 1.3) */
  upperUsd: number;
};

/**
 * 「おまかせで作る」で、これから作る分の見込み。台本が古い(またはない)ときは全シーンを作り直す前提で、
 * 1 シーンの読み上げの長さは「1 シーンの長さの目安 × 5.3 文字/秒」とみなす。
 */
export function estimateProjectGeneration(
  project: Project,
  settings: AppSettings,
  targetPartCount: number
): GenerationEstimate {
  const candidate = { ...project, generationConfig: { ...settings } };
  const needsScript =
    !project.parts.length ||
    project.parts.some((part) => partFreshness(candidate, part).script !== 'current');
  const sceneCount = Math.max(1, needsScript ? targetPartCount : project.parts.length);
  const sceneText = needsScript
    ? '文'.repeat(narrationCharsFor(project.presentationProfile.targetDurationPerPartSec))
    : null;
  const article = project.article.bodyText;
  const count = (kind: 'prompt' | 'image' | 'audio') =>
    needsScript
      ? sceneCount
      : project.parts.filter(
          (part) =>
            partFreshness(candidate, part)[kind] !== 'current' &&
            (kind !== 'prompt' || partFreshness(candidate, part).image !== 'current')
        ).length;
  // 音声はシーンごとに文の長さが違うので、作り直すシーンの文で 1 件ずつ見込む
  const audioUsd = needsScript
    ? sceneCount * estimateGenerationUsd('audio', sceneText!, settings)
    : project.parts
        .filter((part) => partFreshness(candidate, part).audio !== 'current')
        .reduce(
          (sum, part) =>
            sum + estimateGenerationUsd('audio', part.narrationText || part.scriptText, settings),
          0
        );
  const steps: GenerationEstimateStep[] = [
    {
      kind: 'script',
      label: '台本',
      count: needsScript ? 1 : 0,
      usd: needsScript ? estimateGenerationUsd('script', article, settings, sceneCount) : 0,
    },
    {
      kind: 'prompt',
      label: '画像プロンプト',
      count: count('prompt'),
      usd: count('prompt') * estimateGenerationUsd('prompt', article, settings),
    },
    {
      kind: 'image',
      label: '画像',
      count: count('image'),
      usd: count('image') * estimateGenerationUsd('image', '', settings),
    },
    { kind: 'audio', label: '音声', count: count('audio'), usd: audioUsd },
  ];
  const usd = steps.reduce((sum, step) => sum + step.usd, 0);
  return { steps, usd, upperUsd: usd * ESTIMATE_UPPER_MULTIPLIER };
}
