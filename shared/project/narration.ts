import { z } from 'zod';

/**
 * 読み上げの速さ(日本語の文字数 / 秒)。台本の文字数の目安と、見積もりのシーンの長さに使う。
 * 手元の 93 シーンの実測(音声の長さ ÷ 読み上げた文字数)が約 5.3 文字/秒(2026-09 調査)。
 * 以前は 4 文字/秒で換算していたため、目標 30 秒のシーンが実際は約 21 秒になっていた。
 */
export const NARRATION_CHARS_PER_SECOND = 5.3;

/** 秒数を、その長さで読み上げる文字数の目安にする */
export function narrationCharsFor(seconds: number): number {
  return Math.round(seconds * NARRATION_CHARS_PER_SECOND);
}

/** 文字数から、読み上げにかかる秒数の目安を出す */
export function narrationSecondsFor(chars: number): number {
  return chars / NARRATION_CHARS_PER_SECOND;
}

export const readingEntrySchema = z.object({
  word: z.string().min(1).max(100),
  reading: z.string().min(1).max(200),
});
export type ReadingEntry = z.infer<typeof readingEntrySchema>;
export function applyReadings(text: string, entries: ReadingEntry[]) {
  const sorted = [...entries].sort((a, b) => b.word.length - a.word.length);
  if (!sorted.length) return text;
  const pattern = new RegExp(
    sorted.map((entry) => entry.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g'
  );
  return text.replace(pattern, (match) => sorted.find((entry) => entry.word === match)!.reading);
}
