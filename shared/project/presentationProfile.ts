import { z } from 'zod';
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_STYLE_PRESETS,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_STYLE_PRESET,
  isImageAspectRatio,
  isImageStylePreset,
  type ImageAspectRatio,
  type ImageStylePreset,
} from './imageStylePresets';
import {
  TTS_NARRATION_STYLE_PRESETS,
  isTtsNarrationStylePreset,
  type TtsNarrationStylePreset,
} from './ttsNarrationStyles';

export const PRESENTATION_PROFILE_PRESETS = ['news', 'explain', 'report', 'short'] as const;
export type PresentationProfilePreset = (typeof PRESENTATION_PROFILE_PRESETS)[number];

export const SCRIPT_TONES = ['formal', 'casual', 'news'] as const;
export type ScriptTone = (typeof SCRIPT_TONES)[number];

export const CLOSING_LINE_MODES = ['preset', 'none', 'custom'] as const;
export type ClosingLineMode = (typeof CLOSING_LINE_MODES)[number];

export const SOURCE_DISPLAY_MODES = ['auto', 'hidden', 'custom'] as const;
export type SourceDisplayMode = (typeof SOURCE_DISPLAY_MODES)[number];

export type PresentationProfile = {
  preset: PresentationProfilePreset;
  tone: ScriptTone;
  closingLineMode: ClosingLineMode;
  closingLineText: string;
  targetDurationPerPartSec: number;
  imageStylePreset: ImageStylePreset;
  aspectRatio: ImageAspectRatio;
  ttsNarrationStylePreset: TtsNarrationStylePreset;
  ttsNarrationStyleNote: string;
  closingCardEnabled: boolean;
  closingCardHeadline: string;
  closingCardCtaText: string;
  sourceDisplayMode: SourceDisplayMode;
  sourceDisplayText: string;
};

type PresentationProfileDefaults = {
  imageStylePreset?: ImageStylePreset;
  aspectRatio?: ImageAspectRatio;
};

export const PRESENTATION_PROFILE_PRESET_LABELS: Record<PresentationProfilePreset, string> = {
  news: 'ニュース',
  explain: '解説',
  report: '報告',
  short: 'ショート',
};

export const PRESENTATION_PROFILE_PRESET_DESCRIPTIONS: Record<PresentationProfilePreset, string> = {
  news: '客観的で明瞭なニュース番組向けの既定値',
  explain: '落ち着いた解説動画向けの長めの既定値',
  report: '社内報告や業務報告向けの端的な既定値',
  short: '短尺ダイジェスト向けの軽い既定値',
};

export const CLOSING_LINE_MODE_LABELS: Record<ClosingLineMode, string> = {
  preset: 'プリセットを使う',
  none: '入れない',
  custom: 'カスタム',
};

export const SOURCE_DISPLAY_MODE_LABELS: Record<SourceDisplayMode, string> = {
  auto: '記事の出典を使う',
  hidden: '表示しない',
  custom: 'カスタム表記',
};

const TARGET_DURATION_RANGE = { min: 10, max: 300 } as const;

const presetDefaults: Record<PresentationProfilePreset, PresentationProfile> = {
  news: {
    preset: 'news',
    tone: 'news',
    closingLineMode: 'preset',
    closingLineText: '',
    targetDurationPerPartSec: 30,
    imageStylePreset: DEFAULT_IMAGE_STYLE_PRESET,
    aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
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
    targetDurationPerPartSec: 40,
    imageStylePreset: DEFAULT_IMAGE_STYLE_PRESET,
    aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
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
    targetDurationPerPartSec: 25,
    imageStylePreset: DEFAULT_IMAGE_STYLE_PRESET,
    aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
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
    targetDurationPerPartSec: 15,
    imageStylePreset: DEFAULT_IMAGE_STYLE_PRESET,
    aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
    ttsNarrationStylePreset: 'casual',
    ttsNarrationStyleNote: '',
    closingCardEnabled: true,
    closingCardHeadline: 'また次回もご覧ください',
    closingCardCtaText: '',
    sourceDisplayMode: 'hidden',
    sourceDisplayText: '',
  },
};

export const PRESENTATION_PROFILE_PRESET_CLOSING_LINES: Record<PresentationProfilePreset, string> = {
  news: '以上、ニュースをお届けしました',
  explain: '以上、ポイントを解説しました',
  report: '以上、報告をお伝えしました',
  short: '以上、ダイジェストでした',
};

export const presentationProfileSchema = z.object({
  preset: z.enum(PRESENTATION_PROFILE_PRESETS),
  tone: z.enum(SCRIPT_TONES),
  closingLineMode: z.enum(CLOSING_LINE_MODES),
  closingLineText: z.string(),
  targetDurationPerPartSec: z
    .number()
    .int()
    .min(TARGET_DURATION_RANGE.min)
    .max(TARGET_DURATION_RANGE.max),
  imageStylePreset: z.enum(IMAGE_STYLE_PRESETS),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS),
  ttsNarrationStylePreset: z.enum(TTS_NARRATION_STYLE_PRESETS),
  ttsNarrationStyleNote: z.string(),
  closingCardEnabled: z.boolean(),
  closingCardHeadline: z.string(),
  closingCardCtaText: z.string(),
  sourceDisplayMode: z.enum(SOURCE_DISPLAY_MODES),
  sourceDisplayText: z.string(),
});

export const DEFAULT_PRESENTATION_PROFILE: PresentationProfile = presetDefaults.news;

export function isPresentationProfilePreset(value: unknown): value is PresentationProfilePreset {
  return typeof value === 'string' && PRESENTATION_PROFILE_PRESETS.includes(value as PresentationProfilePreset);
}

export function isScriptTone(value: unknown): value is ScriptTone {
  return typeof value === 'string' && SCRIPT_TONES.includes(value as ScriptTone);
}

export function isClosingLineMode(value: unknown): value is ClosingLineMode {
  return typeof value === 'string' && CLOSING_LINE_MODES.includes(value as ClosingLineMode);
}

export function isSourceDisplayMode(value: unknown): value is SourceDisplayMode {
  return typeof value === 'string' && SOURCE_DISPLAY_MODES.includes(value as SourceDisplayMode);
}

export function getDefaultPresentationProfile(
  preset: PresentationProfilePreset = DEFAULT_PRESENTATION_PROFILE.preset,
  defaults: PresentationProfileDefaults = {}
): PresentationProfile {
  return {
    ...presetDefaults[preset],
    imageStylePreset: defaults.imageStylePreset ?? DEFAULT_IMAGE_STYLE_PRESET,
    aspectRatio: defaults.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO,
  };
}

export function normalizePresentationProfile(
  input: unknown,
  defaults: PresentationProfileDefaults = {}
): PresentationProfile {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const preset = isPresentationProfilePreset(raw.preset) ? raw.preset : DEFAULT_PRESENTATION_PROFILE.preset;
  const presetDefaults = getDefaultPresentationProfile(preset, defaults);
  const tone = isScriptTone(raw.tone) ? raw.tone : presetDefaults.tone;
  const closingLineMode = isClosingLineMode(raw.closingLineMode)
    ? raw.closingLineMode
    : presetDefaults.closingLineMode;
  const closingLineText = typeof raw.closingLineText === 'string' ? raw.closingLineText.trim() : '';
  const targetDurationPerPartSec =
    typeof raw.targetDurationPerPartSec === 'number' &&
    Number.isInteger(raw.targetDurationPerPartSec) &&
    raw.targetDurationPerPartSec >= TARGET_DURATION_RANGE.min &&
    raw.targetDurationPerPartSec <= TARGET_DURATION_RANGE.max
      ? raw.targetDurationPerPartSec
      : presetDefaults.targetDurationPerPartSec;
  const imageStylePreset = isImageStylePreset(raw.imageStylePreset)
    ? raw.imageStylePreset
    : presetDefaults.imageStylePreset;
  const aspectRatio = isImageAspectRatio(raw.aspectRatio) ? raw.aspectRatio : presetDefaults.aspectRatio;
  const ttsNarrationStylePreset = isTtsNarrationStylePreset(raw.ttsNarrationStylePreset)
    ? raw.ttsNarrationStylePreset
    : presetDefaults.ttsNarrationStylePreset;
  const ttsNarrationStyleNote =
    typeof raw.ttsNarrationStyleNote === 'string' ? raw.ttsNarrationStyleNote.trim() : '';
  const hasClosingCardSettings =
    'closingCardEnabled' in raw ||
    'closingCardHeadline' in raw ||
    'closingCardCtaText' in raw ||
    'sourceDisplayMode' in raw ||
    'sourceDisplayText' in raw;
  const closingCardEnabled =
    typeof raw.closingCardEnabled === 'boolean'
      ? raw.closingCardEnabled
      : hasClosingCardSettings
        ? presetDefaults.closingCardEnabled
        : false;
  const closingCardHeadline =
    typeof raw.closingCardHeadline === 'string'
      ? raw.closingCardHeadline.trim()
      : presetDefaults.closingCardHeadline;
  const closingCardCtaText =
    typeof raw.closingCardCtaText === 'string'
      ? raw.closingCardCtaText.trim()
      : presetDefaults.closingCardCtaText;
  const sourceDisplayMode = isSourceDisplayMode(raw.sourceDisplayMode)
    ? raw.sourceDisplayMode
    : presetDefaults.sourceDisplayMode;
  const sourceDisplayText =
    typeof raw.sourceDisplayText === 'string' ? raw.sourceDisplayText.trim() : '';

  return {
    preset,
    tone,
    closingLineMode,
    closingLineText,
    targetDurationPerPartSec,
    imageStylePreset,
    aspectRatio,
    ttsNarrationStylePreset,
    ttsNarrationStyleNote,
    closingCardEnabled,
    closingCardHeadline,
    closingCardCtaText,
    sourceDisplayMode,
    sourceDisplayText,
  };
}

export function resolvePresentationClosingLine(profile: PresentationProfile): string | null {
  switch (profile.closingLineMode) {
    case 'none':
      return null;
    case 'custom':
      return profile.closingLineText.trim() || null;
    case 'preset':
    default:
      return PRESENTATION_PROFILE_PRESET_CLOSING_LINES[profile.preset];
  }
}

export function resolvePresentationSourceLine(
  profile: PresentationProfile,
  articleSource: string | null | undefined
): string | null {
  switch (profile.sourceDisplayMode) {
    case 'hidden':
      return null;
    case 'custom':
      return profile.sourceDisplayText.trim() || null;
    case 'auto':
    default: {
      const trimmedSource = typeof articleSource === 'string' ? articleSource.trim() : '';
      return trimmedSource ? `出典: ${trimmedSource}` : null;
    }
  }
}
