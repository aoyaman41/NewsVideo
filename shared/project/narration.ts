import { z } from 'zod';
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
