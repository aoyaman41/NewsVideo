import { describe, expect, it } from 'vitest';
import {
  buildTtsNarrationInstruction,
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
