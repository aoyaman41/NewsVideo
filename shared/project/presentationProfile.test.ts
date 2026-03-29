import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_PROFILE,
  getDefaultPresentationProfile,
  normalizePresentationProfile,
  resolvePresentationClosingLine,
} from './presentationProfile';

describe('normalizePresentationProfile', () => {
  it('falls back to the default news profile when input is missing', () => {
    expect(normalizePresentationProfile(undefined)).toEqual(DEFAULT_PRESENTATION_PROFILE);
  });

  it('uses preset defaults for invalid values', () => {
    const normalized = normalizePresentationProfile({
      preset: 'short',
      tone: 'invalid-tone',
      closingLineMode: 'invalid-mode',
      targetDurationPerPartSec: 999,
      imageStylePreset: 'invalid-style',
      aspectRatio: '21:9',
    });

    expect(normalized).toEqual(getDefaultPresentationProfile('short'));
  });

  it('preserves valid custom overrides', () => {
    const normalized = normalizePresentationProfile({
      preset: 'report',
      tone: 'casual',
      closingLineMode: 'custom',
      closingLineText: 'ご視聴ありがとうございました',
      targetDurationPerPartSec: 18,
      imageStylePreset: 'editorial',
      aspectRatio: '1:1',
    });

    expect(normalized).toEqual({
      preset: 'report',
      tone: 'casual',
      closingLineMode: 'custom',
      closingLineText: 'ご視聴ありがとうございました',
      targetDurationPerPartSec: 18,
      imageStylePreset: 'editorial',
      aspectRatio: '1:1',
    });
  });

  it('accepts default overrides for legacy projects without visual fields', () => {
    const normalized = normalizePresentationProfile(
      {
        preset: 'news',
        tone: 'news',
        closingLineMode: 'preset',
        closingLineText: '',
        targetDurationPerPartSec: 30,
      },
      {
        aspectRatio: '9:16',
      }
    );

    expect(normalized.imageStylePreset).toBe('infographic');
    expect(normalized.aspectRatio).toBe('9:16');
  });
});

describe('resolvePresentationClosingLine', () => {
  it('returns the preset closing line when preset mode is selected', () => {
    expect(resolvePresentationClosingLine(getDefaultPresentationProfile('news'))).toBe(
      '以上、ニュースをお届けしました'
    );
  });

  it('returns null when closing mode is none', () => {
    expect(
      resolvePresentationClosingLine({
        ...getDefaultPresentationProfile('explain'),
        closingLineMode: 'none',
      })
    ).toBeNull();
  });

  it('returns the custom line when provided', () => {
    expect(
      resolvePresentationClosingLine({
        ...getDefaultPresentationProfile('report'),
        closingLineMode: 'custom',
        closingLineText: 'ご確認ありがとうございました',
      })
    ).toBe('ご確認ありがとうございました');
  });
});
