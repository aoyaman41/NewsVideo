export const TTS_NARRATION_STYLE_PRESETS = ['news', 'explain', 'casual', 'promo'] as const;
export type TtsNarrationStylePreset = (typeof TTS_NARRATION_STYLE_PRESETS)[number];

export const DEFAULT_TTS_NARRATION_STYLE_PRESET: TtsNarrationStylePreset = 'news';

export const TTS_NARRATION_STYLE_LABELS: Record<TtsNarrationStylePreset, string> = {
  news: 'ニュース調',
  explain: '落ち着いた解説',
  casual: 'カジュアル',
  promo: 'プロモーション',
};

export const TTS_NARRATION_STYLE_DESCRIPTIONS: Record<TtsNarrationStylePreset, string> = {
  news: '客観的で落ち着いた情報番組向けの読み方',
  explain: 'やわらかく丁寧に説明する読み方',
  casual: '親しみやすく軽めの読み方',
  promo: '明るくテンポよく引き込む読み方',
};

const TTS_NARRATION_STYLE_PROMPTS: Record<TtsNarrationStylePreset, string> = {
  news: '情報番組のナレーションとして、自然な日本語で、落ち着いたニュース調で読み上げてください。',
  explain:
    '解説動画のナレーションとして、自然な日本語で、丁寧かつ落ち着いた口調で読み上げてください。',
  casual:
    'カジュアルな動画ナレーションとして、自然な日本語で、親しみやすく軽やかな口調で読み上げてください。',
  promo:
    'プロモーション動画のナレーションとして、自然な日本語で、明るくテンポよく惹きつける口調で読み上げてください。',
};

export function isTtsNarrationStylePreset(value: unknown): value is TtsNarrationStylePreset {
  return (
    typeof value === 'string' &&
    TTS_NARRATION_STYLE_PRESETS.includes(value as TtsNarrationStylePreset)
  );
}

export function buildTtsNarrationInstruction(
  preset: TtsNarrationStylePreset,
  note?: string | null
): string {
  const base = TTS_NARRATION_STYLE_PROMPTS[preset];
  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  if (!trimmedNote) return base;
  return `${base}\n補足: ${trimmedNote}`;
}
