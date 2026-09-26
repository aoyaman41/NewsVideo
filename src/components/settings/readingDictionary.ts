import type { ReadingEntry } from '../../../shared/project/narration';

export type ReadingRow = { id: string; word: string; reading: string };

export const READING_WORD_MAX = 100;
export const READING_MAX = 200;
export const READING_ENTRIES_MAX = 500;

export function entriesToRows(
  entries: readonly ReadingEntry[] | undefined,
  makeId: () => string
): ReadingRow[] {
  return (entries ?? []).map((entry) => ({ id: makeId(), ...entry }));
}

/**
 * 画面の行を保存する形にする。表記と読みの両方がある行だけを、前後の空白を除いて残す
 * (保存の検証に合わせて長さと件数を切りそろえる)。
 */
export function rowsToEntries(rows: readonly ReadingRow[]): ReadingEntry[] {
  return rows
    .map((row) => ({
      word: row.word.trim().slice(0, READING_WORD_MAX),
      reading: row.reading.trim().slice(0, READING_MAX),
    }))
    .filter((entry) => entry.word && entry.reading)
    .slice(0, READING_ENTRIES_MAX);
}

/** 片方だけ入力された行など、保存されない行の案内 */
export function rowProblem(row: ReadingRow, rows: readonly ReadingRow[]): string | null {
  const word = row.word.trim();
  const reading = row.reading.trim();
  if (!word && !reading) return null;
  if (!word) return '表記を入力してください(この行は保存されません)';
  if (!reading) return '読みを入力してください(この行は保存されません)';
  const firstSame = rows.find((other) => other.word.trim() === word && other.reading.trim());
  if (firstSame && firstSame.id !== row.id) return '同じ表記が上にあります(上の行が使われます)';
  return null;
}
