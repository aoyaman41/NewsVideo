import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_STYLE_PRESET,
  type ImageAspectRatio,
  type ImageStylePreset,
} from './imageStylePresets';
// 型だけを読む(presentationProfile.ts はこのファイルの値を読むので、実行時の import は循環になる)
import type { PresentationProfile, PresentationProfilePreset } from './presentationProfile';
import type { NewProjectDefaults } from '../settings/appSettings';

/**
 * 用途(動画の種類)ごとの値は、すべてこのファイルで決める(M5 で一元化)。
 * 以前は presentationProfile.ts にも別の値があり、解説は 30 秒と 40 秒、ショートは 20 秒と 15 秒、
 * シーン数の予備値は 5 と 3 で食い違っていた。
 *
 * - 作成画面と記事画面の「用途」の選択肢: PURPOSES(ニュース・解説・ショートの 3 種)
 * - 「報告」は以前の記事画面で選べた用途。保存済みの動画を読めるよう値だけ残し、選択肢には出さない
 * - 用途の性格を決める項目(画面の縦横・1 シーンの長さ・シーン数)は用途が決める。設定では変えない
 */
export type PurposeSpec = {
  id: PresentationProfilePreset;
  /** 選択肢の名前 */
  label: string;
  /** 選択肢の補足(向いている使い方) */
  note: string;
  /** シーン数 */
  parts: number;
  /** 1 シーンの長さの目安(秒) */
  secondsPerPart: number;
  /** 動画全体の長さの目安(秒)。シーン数 × 1 シーンの長さ */
  seconds: number;
  /** 画面の縦横 */
  aspectRatio: ImageAspectRatio;
};

function spec(value: Omit<PurposeSpec, 'seconds'>): PurposeSpec {
  return { ...value, seconds: value.parts * value.secondsPerPart };
}

export const PURPOSE_SPECS: Record<PresentationProfilePreset, PurposeSpec> = {
  news: spec({
    id: 'news',
    label: '90秒・定期ニュース',
    note: '定期ニュース向け',
    parts: 3,
    secondsPerPart: 30,
    aspectRatio: '16:9',
  }),
  explain: spec({
    id: 'explain',
    label: '3分・じっくり解説',
    note: 'じっくり解説したいとき',
    parts: 6,
    secondsPerPart: 30,
    aspectRatio: '16:9',
  }),
  // 縦型の SNS 動画は画面の変化を速くする(3 シーン × 20 秒 → 5 シーン × 12 秒。ユーザー決定 2026-09-26)
  short: spec({
    id: 'short',
    label: '60秒・縦型ダイジェスト',
    note: 'SNS のショート動画向け',
    parts: 5,
    secondsPerPart: 12,
    aspectRatio: '9:16',
  }),
  report: spec({
    id: 'report',
    label: '報告(以前の用途)',
    note: '社内報告や業務報告向け',
    parts: 3,
    secondsPerPart: 25,
    aspectRatio: '16:9',
  }),
};

/** 作成画面と記事画面で選べる用途(この順に並べる) */
export const PURPOSE_IDS = ['news', 'explain', 'short'] as const;
export type PurposeId = (typeof PURPOSE_IDS)[number];
export const PURPOSES: readonly PurposeSpec[] = PURPOSE_IDS.map((id) => PURPOSE_SPECS[id]);

export const DEFAULT_PURPOSE_ID: PurposeId = 'news';
/** シーン数の指定がないときの値(既定の用途のシーン数) */
export const DEFAULT_SCENE_COUNT = PURPOSE_SPECS[DEFAULT_PURPOSE_ID].parts;
/** 1 シーンの長さの指定がないときの値(既定の用途の値) */
export const DEFAULT_SECONDS_PER_PART = PURPOSE_SPECS[DEFAULT_PURPOSE_ID].secondsPerPart;

export function isPurposeId(value: unknown): value is PurposeId {
  return typeof value === 'string' && (PURPOSE_IDS as readonly string[]).includes(value);
}

const ASPECT_WORDS: Record<ImageAspectRatio, string> = {
  '16:9': '横長',
  '9:16': '縦長',
  '1:1': '正方形',
};

function formatSeconds(seconds: number): string {
  return seconds >= 120 && seconds % 60 === 0 ? `${seconds / 60} 分` : `${seconds} 秒`;
}

/** 「横長・約 90 秒・3 シーン」の形の説明 */
export function describePurpose(purpose: PurposeSpec): string {
  return `${ASPECT_WORDS[purpose.aspectRatio]}・約 ${formatSeconds(purpose.seconds)}・${purpose.parts} シーン`;
}

type PresetProfileDefaults = Omit<
  PresentationProfile,
  'targetDurationPerPartSec' | 'imageStylePreset' | 'aspectRatio'
>;

/** 用途ごとの話し方・締め・出典の既定値(1 シーンの長さは PURPOSE_SPECS から入れる) */
const PRESET_PROFILE_DEFAULTS: Record<PresentationProfilePreset, PresetProfileDefaults> = {
  news: {
    preset: 'news',
    tone: 'news',
    closingLineMode: 'preset',
    closingLineText: '',
    styleReferenceImageIds: [],
    styleReferenceNote: '',
    ttsNarrationStylePreset: 'news',
    ttsNarrationStyleNote: '',
    closingCardEnabled: true,
    closingCardHeadline: 'ご視聴ありがとうございました',
    closingCardCtaText: '',
    sourceDisplayMode: 'auto',
    sourceDisplayText: '',
  },
  explain: {
    preset: 'explain',
    tone: 'formal',
    closingLineMode: 'preset',
    closingLineText: '',
    styleReferenceImageIds: [],
    styleReferenceNote: '',
    ttsNarrationStylePreset: 'explain',
    ttsNarrationStyleNote: '',
    closingCardEnabled: true,
    closingCardHeadline: '最後までご覧いただきありがとうございました',
    closingCardCtaText: '',
    sourceDisplayMode: 'auto',
    sourceDisplayText: '',
  },
  report: {
    preset: 'report',
    tone: 'formal',
    closingLineMode: 'preset',
    closingLineText: '',
    styleReferenceImageIds: [],
    styleReferenceNote: '',
    ttsNarrationStylePreset: 'explain',
    ttsNarrationStyleNote: '',
    closingCardEnabled: true,
    closingCardHeadline: 'ご確認ありがとうございました',
    closingCardCtaText: '',
    sourceDisplayMode: 'auto',
    sourceDisplayText: '',
  },
  short: {
    preset: 'short',
    tone: 'casual',
    closingLineMode: 'preset',
    closingLineText: '',
    styleReferenceImageIds: [],
    styleReferenceNote: '',
    ttsNarrationStylePreset: 'casual',
    ttsNarrationStyleNote: '',
    closingCardEnabled: true,
    closingCardHeadline: 'また次回もご覧ください',
    closingCardCtaText: '',
    sourceDisplayMode: 'hidden',
    sourceDisplayText: '',
  },
};

export type PresentationProfileDefaults = {
  imageStylePreset?: ImageStylePreset;
  aspectRatio?: ImageAspectRatio;
};

/**
 * 用途の既定の見せ方。画面の縦横は、指定がなければ 16:9(保存済みの値の補完に使うため、用途の縦横は入れない)。
 * 新しい動画を作るときは purposeProfile か applyNewProjectDefaults を使う。
 */
export function getDefaultPresentationProfile(
  preset: PresentationProfilePreset = DEFAULT_PURPOSE_ID,
  defaults: PresentationProfileDefaults = {}
): PresentationProfile {
  const base = PRESET_PROFILE_DEFAULTS[preset];
  return {
    ...base,
    styleReferenceImageIds: [...base.styleReferenceImageIds],
    targetDurationPerPartSec: PURPOSE_SPECS[preset].secondsPerPart,
    imageStylePreset: defaults.imageStylePreset ?? DEFAULT_IMAGE_STYLE_PRESET,
    aspectRatio: defaults.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO,
  };
}

/** 新しい動画がその用途で始まるときの見せ方(画面の縦横も用途に合わせる) */
export function purposeProfile(preset: PresentationProfilePreset): PresentationProfile {
  return {
    ...getDefaultPresentationProfile(preset),
    aspectRatio: PURPOSE_SPECS[preset].aspectRatio,
  };
}

/**
 * 「新しい動画」の既定値が決める見せ方の項目。記事画面の「既定と違う」の印と「既定に戻す」も、この一覧を使う。
 * 用途の性格を決める項目(画面の縦横・1 シーンの長さ・シーン数)と話し方の調子(tone)は含めない
 */
export const NEW_PROJECT_DEFAULT_PROFILE_KEYS = [
  'imageStylePreset',
  'styleReferenceNote',
  'ttsNarrationStylePreset',
  'ttsNarrationStyleNote',
  'closingLineMode',
  'closingLineText',
  'closingCardEnabled',
  'closingCardHeadline',
  'closingCardCtaText',
  'sourceDisplayMode',
  'sourceDisplayText',
] as const satisfies readonly (keyof PresentationProfile & keyof NewProjectDefaults)[];

/**
 * 用途の見せ方に「新しい動画」の既定値を重ねる。新しい動画を作るとき(project:create)と、
 * 記事画面で「既定」を求めるときに使う。
 * - 用途の性格を決める項目(画面の縦横・1 シーンの長さ・シーン数・話し方の調子)は用途を優先する
 * - 見た目と締めの項目(画像の雰囲気・話し方・締め・出典)は既定値を優先する。
 *   既定値が「用途に合わせる」(null・空欄)の項目は、用途の値を使う
 */
export function applyNewProjectDefaults(
  preset: PresentationProfilePreset,
  defaults: NewProjectDefaults
): { presentationProfile: PresentationProfile; targetPartCount: number } {
  const base = purposeProfile(preset);
  return {
    presentationProfile: {
      ...base,
      imageStylePreset: defaults.imageStylePreset,
      styleReferenceNote: defaults.styleReferenceNote,
      ttsNarrationStylePreset: defaults.ttsNarrationStylePreset ?? base.ttsNarrationStylePreset,
      ttsNarrationStyleNote: defaults.ttsNarrationStyleNote,
      closingLineMode: defaults.closingLineMode,
      closingLineText: defaults.closingLineText,
      closingCardEnabled: defaults.closingCardEnabled,
      closingCardHeadline: defaults.closingCardHeadline.trim() || base.closingCardHeadline,
      closingCardCtaText: defaults.closingCardCtaText,
      sourceDisplayMode: defaults.sourceDisplayMode ?? base.sourceDisplayMode,
      sourceDisplayText: defaults.sourceDisplayText,
    },
    targetPartCount: PURPOSE_SPECS[preset].parts,
  };
}

/**
 * 作成済みの動画の見せ方に、「新しい動画」の既定値の項目だけを入れ直す(「まだ台本がない動画にも適用」で使う)。
 * 用途・画面の縦横・1 シーンの長さ・参考画像など、既定値に含まれない項目はそのまま残す
 */
export function withNewProjectDefaults(
  profile: PresentationProfile,
  defaults: NewProjectDefaults
): PresentationProfile {
  const next = applyNewProjectDefaults(profile.preset, defaults).presentationProfile;
  const result = { ...profile };
  for (const key of NEW_PROJECT_DEFAULT_PROFILE_KEYS) {
    (result as Record<string, unknown>)[key] = next[key];
  }
  return result;
}
