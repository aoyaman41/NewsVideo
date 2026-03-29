import { z } from 'zod';

export const PRESENTATION_PROFILE_PRESETS = ['news', 'explain', 'report', 'short'] as const;
export type PresentationProfilePreset = (typeof PRESENTATION_PROFILE_PRESETS)[number];

export const SCRIPT_TONES = ['formal', 'casual', 'news'] as const;
export type ScriptTone = (typeof SCRIPT_TONES)[number];

export const CLOSING_LINE_MODES = ['preset', 'none', 'custom'] as const;
export type ClosingLineMode = (typeof CLOSING_LINE_MODES)[number];

export type PresentationProfile = {
  preset: PresentationProfilePreset;
  tone: ScriptTone;
  closingLineMode: ClosingLineMode;
  closingLineText: string;
  targetDurationPerPartSec: number;
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

const TARGET_DURATION_RANGE = { min: 10, max: 300 } as const;

const presetDefaults: Record<PresentationProfilePreset, PresentationProfile> = {
  news: {
    preset: 'news',
    tone: 'news',
    closingLineMode: 'preset',
    closingLineText: '',
    targetDurationPerPartSec: 30,
  },
  explain: {
    preset: 'explain',
    tone: 'formal',
    closingLineMode: 'preset',
    closingLineText: '',
    targetDurationPerPartSec: 40,
  },
  report: {
    preset: 'report',
    tone: 'formal',
    closingLineMode: 'preset',
    closingLineText: '',
    targetDurationPerPartSec: 25,
  },
  short: {
    preset: 'short',
    tone: 'casual',
    closingLineMode: 'preset',
    closingLineText: '',
    targetDurationPerPartSec: 15,
  },
};

const presetClosingLines: Record<PresentationProfilePreset, string> = {
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

export function getDefaultPresentationProfile(
  preset: PresentationProfilePreset = DEFAULT_PRESENTATION_PROFILE.preset
): PresentationProfile {
  return { ...presetDefaults[preset] };
}

export function normalizePresentationProfile(input: unknown): PresentationProfile {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const preset = isPresentationProfilePreset(raw.preset) ? raw.preset : DEFAULT_PRESENTATION_PROFILE.preset;
  const defaults = getDefaultPresentationProfile(preset);
  const tone = isScriptTone(raw.tone) ? raw.tone : defaults.tone;
  const closingLineMode = isClosingLineMode(raw.closingLineMode)
    ? raw.closingLineMode
    : defaults.closingLineMode;
  const closingLineText = typeof raw.closingLineText === 'string' ? raw.closingLineText.trim() : '';
  const targetDurationPerPartSec =
    typeof raw.targetDurationPerPartSec === 'number' &&
    Number.isInteger(raw.targetDurationPerPartSec) &&
    raw.targetDurationPerPartSec >= TARGET_DURATION_RANGE.min &&
    raw.targetDurationPerPartSec <= TARGET_DURATION_RANGE.max
      ? raw.targetDurationPerPartSec
      : defaults.targetDurationPerPartSec;

  return {
    preset,
    tone,
    closingLineMode,
    closingLineText,
    targetDurationPerPartSec,
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
      return presetClosingLines[profile.preset];
  }
}
