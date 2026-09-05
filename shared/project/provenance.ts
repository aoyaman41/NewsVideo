import { z } from 'zod';
export const sourceRecordSchema = z.object({ id: z.string().uuid(), url: z.string(), publisher: z.string(), publishedAt: z.string(), retrievedAt: z.string().datetime(), snapshot: z.string() });
export const claimSchema = z.object({ id: z.string().uuid(), text: z.string(), sourceId: z.string().uuid().optional(), evidence: z.string(), status: z.enum(['unverified', 'consistent', 'externally_verified']), note: z.string(), checkedAt: z.string().datetime().optional(), checkedInput: z.string().optional() });
export const rightsSchema = z.object({ origin: z.enum(['generated', 'shot', 'reused']), terms: z.string(), attribution: z.string() });
/** Editorial leads only. These tokens never automatically establish truth. */
export function priorityTerms(text: string) {
  return [...new Set(text.match(/[0-9０-９]+(?:[.,．][0-9０-９]+)*(?:年|月|日|億|万|円|ドル|%|％|人|件|km|kg|秒)?|[A-Z][A-Za-z0-9.-]+|[一-龯ぁ-んァ-ヶー]{2,}(?:株式会社|大学|省|市|県)/g) ?? [])];
}
export function unmatchedTerms(text: string, source: string) { return priorityTerms(text).filter((term) => !source.includes(term)); }
