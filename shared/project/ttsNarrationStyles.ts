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

/**
 * 3.1 / 2.5 の TTS 用。日本語の命令文を本文の前に付ける方式で使う。
 */
export function buildTtsNarrationInstruction(
  preset: TtsNarrationStylePreset,
  note?: string | null
): string {
  const base = TTS_NARRATION_STYLE_PROMPTS[preset];
  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  if (!trimmedNote) return base;
  return `${base}\n補足: ${trimmedNote}`;
}

// 3.8 TTS 用の短いスタイル記述子。公式は短い記述子を推奨し、長い指示は声のぶれの原因になるとしている
const TTS_STYLE_DESCRIPTORS: Record<TtsNarrationStylePreset, string> = {
  news: 'calm, clear news narration',
  explain: 'warm, measured explainer narration',
  casual: 'friendly, relaxed conversational narration',
  promo: 'bright, upbeat promotional narration',
};

/** 3.8 TTS のスタイルに付ける自由記述の補足の上限(文字数)。超えた分は切り捨てる */
export const TTS_STYLE_NOTE_MAX_CHARS = 40;

/**
 * 3.8 TTS 用のスタイル(part.speechMetadata.style)。プリセットの短い記述子の末尾に、
 * 自由記述の補足(narrationStyleNote)を 1 行にまとめて短く切り詰めて付ける。
 */
export function buildTtsStyleDescriptor(
  preset: TtsNarrationStylePreset,
  note?: string | null
): string {
  const descriptor = TTS_STYLE_DESCRIPTORS[preset];
  const normalizedNote = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
  if (!normalizedNote) return descriptor;
  const shortNote = Array.from(normalizedNote).slice(0, TTS_STYLE_NOTE_MAX_CHARS).join('').trim();
  return `${descriptor}; ${shortNote}`;
}
