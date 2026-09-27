import { describe, expect, it } from 'vitest';
import { getGeminiImageSizeTier, getImageSizeTier, getOpenAIImageQuality } from './imageQuality';

describe('image quality mapping', () => {
  it('generates Gemini images at 2K for Full HD and 2K, and 4K for 4K', () => {
    expect(getGeminiImageSizeTier('fhd')).toBe('2K');
    expect(getGeminiImageSizeTier('2k')).toBe('2K');
    expect(getGeminiImageSizeTier('4k')).toBe('4K');
  });

  it('uses medium quality for GPT Image at Full HD and 2K, and high at 4K', () => {
    expect(getOpenAIImageQuality('fhd')).toBe('medium');
    expect(getOpenAIImageQuality('2k')).toBe('medium');
    expect(getOpenAIImageQuality('4k')).toBe('high');
  });

  it('records the size tier that each provider actually uses', () => {
    expect(getImageSizeTier('gemini', 'fhd')).toBe('2K');
    expect(getImageSizeTier('openai', 'fhd')).toBe('1K');
    expect(getImageSizeTier('openai', '2k')).toBe('2K');
    expect(getImageSizeTier('openai', '4k')).toBe('4K');
  });
});
