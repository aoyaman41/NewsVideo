import { expect, it } from 'vitest';
import { serializeCaptions, estimateCaptions, captionProblems } from './captions';
import { createNewPart } from './schema';
import { applyReadings } from './narration';
import { measurePcmWav } from './audioQuality';
it('distinguishes estimated timing and exports precise SRT and VTT timestamps', () => {
  const cues = estimateCaptions(
    createNewPart(0, { scriptText: '最初の文。次の文。', durationEstimateSec: 10 })
  );
  expect(cues.every((cue) => cue.timing === 'estimated')).toBe(true);
  expect(cues.at(-1)?.end).toBeCloseTo(10);
  const cue = { ...cues[0], start: 1.125, end: 2.5, timing: 'manual' as const };
  expect(serializeCaptions([cue], 'srt')).toContain('00:00:01,125 --> 00:00:02,500');
  expect(serializeCaptions([cue], 'vtt')).toContain('WEBVTT\n\n1\n00:00:01.125');
  expect(captionProblems([{ ...cue, end: 20 }], 10)).toContain('字幕1: 音声の尺を超えています');
});
it('applies the longest matching dictionary entry without re-replacing generated readings', () => {
  expect(
    applyReadings('OpenAI API', [
      { word: 'OpenAI', reading: 'オープンエーアイ' },
      { word: 'OpenAI API', reading: '専用の読み' },
      { word: '専用', reading: '変更' },
    ])
  ).toBe('専用の読み');
  expect(applyReadings('C++', [{ word: 'C++', reading: 'シープラスプラス' }])).toBe(
    'シープラスプラス'
  );
});
it('measures PCM duration, silence and clipping rather than estimating from text', () => {
  const bytes = new Uint8Array(44 + 200);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, i) => (bytes[offset + i] = char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 100, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, 200, true);
  view.setInt16(44, 32767, true);
  expect(measurePcmWav(bytes)).toMatchObject({
    durationSec: 1,
    silenceRatio: 0.99,
    clippedSamples: 1,
  });
  expect(() => measurePcmWav(bytes.subarray(0, 80))).toThrow('途中');
});
