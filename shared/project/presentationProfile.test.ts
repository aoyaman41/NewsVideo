import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_PROFILE,
  getDefaultPresentationProfile,
  normalizePresentationProfile,
  resolvePresentationClosingLine,
  resolvePresentationSourceLine,
} from './presentationProfile';

describe('normalizePresentationProfile', () => {
  it('treats missing input as a legacy profile and disables the closing card by default', () => {
    expect(normalizePresentationProfile(undefined)).toEqual({
      ...DEFAULT_PRESENTATION_PROFILE,
      closingCardEnabled: false,
    });
  });

  it('uses preset defaults for invalid values while keeping legacy closing-card compatibility', () => {
    const normalized = normalizePresentationProfile({
      preset: 'short',
      tone: 'invalid-tone',
      closingLineMode: 'invalid-mode',
      targetDurationPerPartSec: 999,
      imageStylePreset: 'invalid-style',
      aspectRatio: '21:9',
      ttsNarrationStylePreset: 'invalid-tts-style',
    });

    expect(normalized).toEqual({
      ...getDefaultPresentationProfile('short'),
      closingCardEnabled: false,
    });
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
      styleReferenceImageIds: ['11111111-1111-4111-8111-111111111111'],
      styleReferenceNote: '見出しを太めに',
      ttsNarrationStylePreset: 'promo',
      ttsNarrationStyleNote: '語尾はやわらかめに',
      closingCardEnabled: false,
      closingCardHeadline: '資料の確認ありがとうございました',
      closingCardCtaText: '詳細はポータルを確認してください',
      sourceDisplayMode: 'custom',
      sourceDisplayText: '社内資料 2026-03-29 時点',
    });

    expect(normalized).toEqual({
      preset: 'report',
      tone: 'casual',
      closingLineMode: 'custom',
      closingLineText: 'ご視聴ありがとうございました',
      targetDurationPerPartSec: 18,
      imageStylePreset: 'editorial',
      aspectRatio: '1:1',
      styleReferenceImageIds: ['11111111-1111-4111-8111-111111111111'],
      styleReferenceNote: '見出しを太めに',
      ttsNarrationStylePreset: 'promo',
      ttsNarrationStyleNote: '語尾はやわらかめに',
      closingCardEnabled: false,
      closingCardHeadline: '資料の確認ありがとうございました',
      closingCardCtaText: '詳細はポータルを確認してください',
      sourceDisplayMode: 'custom',
      sourceDisplayText: '社内資料 2026-03-29 時点',
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
    expect(normalized.ttsNarrationStylePreset).toBe('news');
    expect(normalized.closingCardEnabled).toBe(false);
    expect(normalized.sourceDisplayMode).toBe('auto');
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

describe('resolvePresentationSourceLine', () => {
  it('uses the article source in auto mode', () => {
    expect(
      resolvePresentationSourceLine(getDefaultPresentationProfile('news'), '架空ニュース通信')
    ).toBe('出典: 架空ニュース通信');
  });

  it('returns null when source display is hidden', () => {
    expect(
      resolvePresentationSourceLine(
        {
          ...getDefaultPresentationProfile('short'),
          sourceDisplayMode: 'hidden',
        },
        '架空ニュース通信'
      )
    ).toBeNull();
  });

  it('returns custom source text when configured', () => {
    expect(
      resolvePresentationSourceLine(
        {
          ...getDefaultPresentationProfile('report'),
          sourceDisplayMode: 'custom',
          sourceDisplayText: '社内広報資料',
        },
        'ignored'
      )
    ).toBe('社内広報資料');
  });
});
