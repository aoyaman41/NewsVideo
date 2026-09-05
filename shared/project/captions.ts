import { z } from 'zod';
import { splitScriptIntoSegments, parseMarkIndex } from '../utils/ttsSegmentation';
import type { Part } from './schema';
export const captionSchema = z.object({ id: z.string().uuid(), start: z.number().nonnegative(), end: z.number().positive(), text: z.string(), timing: z.enum(['tts', 'estimated', 'manual']) });
export type Caption = z.infer<typeof captionSchema>;
export const graphicSchema = z.object({ enabled: z.boolean(), headline: z.string().max(100), keyNumber: z.string().max(40), source: z.string().max(180), bars: z.array(z.object({ label: z.string().max(30), value: z.number().min(0).max(100) })).max(4) });
export function estimateCaptions(part: Part): Caption[] {
  const texts = splitScriptIntoSegments(part.scriptText);
  const total = texts.reduce((sum, text) => sum + text.length, 0) || 1;
  const duration = part.audio?.durationSec ?? part.durationEstimateSec;
  const marks = new Map(part.audio?.timepoints?.map((mark) => [parseMarkIndex(mark.markName), mark.timeSeconds]));
  let previous = 0;
  return texts.map((text, index) => { const start = marks.get(index) ?? previous; const end = marks.get(index + 1) ?? Math.min(duration, start + duration * text.length / total); previous = end; return { id: crypto.randomUUID(), text, start, end: Math.max(start + .01, end), timing: marks.has(index) ? 'tts' : 'estimated' }; });
}
export function captionProblems(captions: Caption[], duration: number) {
  return captions.flatMap((cue, i) => [cue.end <= cue.start ? `字幕${i + 1}: 終了が開始以前です` : '', cue.end > duration + .1 ? `字幕${i + 1}: 音声の尺を超えています` : '', i > 0 && cue.start < captions[i - 1].end ? `字幕${i + 1}: 前の字幕と重なっています` : '', cue.text.split('\n').some((line) => [...line].length > 30) || cue.text.split('\n').length > 2 ? `字幕${i + 1}: 30文字×2行の目安を超えています` : ''].filter(Boolean));
}
function timestamp(seconds: number, format: 'srt' | 'vtt') {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`;
}
export function serializeCaptions(captions: Caption[], format: 'srt' | 'vtt') {
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + captions.map((cue, i) => `${i + 1}\n${timestamp(cue.start, format)} --> ${timestamp(cue.end, format)}\n${cue.text.replace(/-->/g, '→').replace(/\n\n+/g, '\n')}\n`).join('\n');
}
