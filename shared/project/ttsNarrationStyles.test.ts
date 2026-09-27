import { describe, expect, it } from 'vitest';
import {
  TTS_NARRATION_STYLE_PRESETS,
  TTS_STYLE_NOTE_MAX_CHARS,
  buildTtsNarrationInstruction,
  buildTtsStyleDescriptor,
  isTtsNarrationStylePreset,
} from './ttsNarrationStyles';

describe('ttsNarrationStyles', () => {
  it('recognizes valid presets and rejects invalid values', () => {
    expect(isTtsNarrationStylePreset('news')).toBe(true);
    expect(isTtsNarrationStylePreset('promo')).toBe(true);
    expect(isTtsNarrationStylePreset('invalid')).toBe(false);
  });

  it('appends a short override note when provided', () => {
    expect(buildTtsNarrationInstruction('explain', '語尾はやわらかく')).toContain(
      '補足: 語尾はやわらかく'
    );
    expect(buildTtsNarrationInstruction('news')).toContain('ニュース調');
  });
});

describe('buildTtsStyleDescriptor (Gemini 3.8 TTS)', () => {
  it('uses a short descriptor for every preset', () => {
    expect(buildTtsStyleDescriptor('news')).toBe('calm, clear news narration');
    for (const preset of TTS_NARRATION_STYLE_PRESETS) {
      const descriptor = buildTtsStyleDescriptor(preset);
      expect(descriptor.length).toBeLessThanOrEqual(50);
      expect(descriptor).not.toContain('読み上げてください');
    }
  });

  it('appends the note on one line and truncates it', () => {
    expect(buildTtsStyleDescriptor('explain', '  語尾は\nやわらかく  ')).toBe(
      'warm, measured explainer narration; 語尾は やわらかく'
    );
    const longNote = 'あ'.repeat(TTS_STYLE_NOTE_MAX_CHARS + 20);
    expect(buildTtsStyleDescriptor('news', longNote)).toBe(
      `calm, clear news narration; ${'あ'.repeat(TTS_STYLE_NOTE_MAX_CHARS)}`
    );
    expect(buildTtsStyleDescriptor('promo', '   ')).toBe('bright, upbeat promotional narration');
  });
});
