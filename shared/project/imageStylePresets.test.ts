import { describe, expect, it } from 'vitest';
import {
  getImageLayoutVariant,
  getImageStylePresetConfig,
  isImageAspectRatio,
  isImageStylePreset,
} from './imageStylePresets';

describe('imageStylePresets', () => {
  it('falls back to the default style preset for invalid input', () => {
    expect(getImageStylePresetConfig('invalid-style').id).toBe('infographic');
    expect(isImageStylePreset('editorial')).toBe(true);
    expect(isImageStylePreset('invalid-style')).toBe(false);
  });

  it('returns aspect-ratio specific layout variants', () => {
    expect(getImageLayoutVariant('16:9', true, false)).toContain('横長');
    expect(getImageLayoutVariant('1:1', false, true)).toContain('正方形');
    expect(getImageLayoutVariant('9:16', false, false)).toContain('縦長');
    expect(isImageAspectRatio('9:16')).toBe(true);
    expect(isImageAspectRatio('4:3')).toBe(false);
  });
});
