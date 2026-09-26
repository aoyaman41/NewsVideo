import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENE_COUNT,
  DEFAULT_SECONDS_PER_PART,
  NEW_PROJECT_DEFAULT_PROFILE_KEYS,
  PURPOSES,
  PURPOSE_SPECS,
  applyNewProjectDefaults,
  describePurpose,
  purposeProfile,
  withNewProjectDefaults,
} from './purposes';
import {
  PRESENTATION_PROFILE_PRESETS,
  getDefaultPresentationProfile,
  normalizePresentationProfile,
} from './presentationProfile';
import { DEFAULT_NEW_PROJECT_DEFAULTS, type NewProjectDefaults } from '../settings/appSettings';

// M5: 用途ごとの値は purposes.ts の 1 か所で決める
describe('purposes', () => {
  it('offers the same three purposes on the creation and article screens', () => {
    expect(PURPOSES.map((purpose) => purpose.id)).toEqual(['news', 'explain', 'short']);
  });

  it('keeps each purpose consistent: length = scenes × seconds per scene', () => {
    expect(PURPOSE_SPECS.news).toMatchObject({
      parts: 3,
      secondsPerPart: 30,
      seconds: 90,
      aspectRatio: '16:9',
    });
    expect(PURPOSE_SPECS.explain).toMatchObject({
      parts: 6,
      secondsPerPart: 30,
      seconds: 180,
      aspectRatio: '16:9',
    });
    // ショートは 5 シーン × 12 秒(ユーザー決定 2026-09-26)
    expect(PURPOSE_SPECS.short).toMatchObject({
      parts: 5,
      secondsPerPart: 12,
      seconds: 60,
      aspectRatio: '9:16',
    });
    expect(DEFAULT_SCENE_COUNT).toBe(3);
    expect(DEFAULT_SECONDS_PER_PART).toBe(30);
  });

  it('uses the same seconds per scene in the presentation profile defaults (no second source)', () => {
    for (const preset of PRESENTATION_PROFILE_PRESETS) {
      expect(getDefaultPresentationProfile(preset).targetDurationPerPartSec).toBe(
        PURPOSE_SPECS[preset].secondsPerPart
      );
      // 保存値が壊れているときの補完も同じ値
      expect(
        normalizePresentationProfile({ preset, targetDurationPerPartSec: 0 })
          .targetDurationPerPartSec
      ).toBe(PURPOSE_SPECS[preset].secondsPerPart);
    }
  });

  it('describes purposes for the choices', () => {
    expect(describePurpose(PURPOSE_SPECS.news)).toBe('横長・約 90 秒・3 シーン');
    expect(describePurpose(PURPOSE_SPECS.explain)).toBe('横長・約 3 分・6 シーン');
    expect(describePurpose(PURPOSE_SPECS.short)).toBe('縦長・約 60 秒・5 シーン');
  });

  it('starts a purpose with its own aspect ratio', () => {
    expect(purposeProfile('short')).toMatchObject({
      preset: 'short',
      aspectRatio: '9:16',
      targetDurationPerPartSec: 12,
      tone: 'casual',
    });
    expect(purposeProfile('news').aspectRatio).toBe('16:9');
  });
});

describe('applyNewProjectDefaults', () => {
  const custom: NewProjectDefaults = {
    purpose: 'news',
    imageStylePreset: 'editorial',
    styleReferenceNote: '青を基調に',
    ttsNarrationStylePreset: 'promo',
    ttsNarrationStyleNote: '明るく',
    closingLineMode: 'custom',
    closingLineText: '文京経済新聞でした',
    closingCardEnabled: false,
    closingCardHeadline: 'ご覧いただきありがとうございました',
    closingCardCtaText: 'サイトで続きを',
    sourceDisplayMode: 'custom',
    sourceDisplayText: '出典: 文京経済新聞',
  };

  it('keeps the purpose values as they were when the defaults are untouched', () => {
    for (const purpose of PURPOSES) {
      const setup = applyNewProjectDefaults(purpose.id, DEFAULT_NEW_PROJECT_DEFAULTS);
      expect(setup.presentationProfile).toEqual(purposeProfile(purpose.id));
      expect(setup.targetPartCount).toBe(purpose.parts);
    }
  });

  it('lets the purpose decide the aspect ratio, length, scene count and tone', () => {
    const setup = applyNewProjectDefaults('short', custom);
    expect(setup.targetPartCount).toBe(5);
    expect(setup.presentationProfile).toMatchObject({
      preset: 'short',
      tone: 'casual',
      aspectRatio: '9:16',
      targetDurationPerPartSec: 12,
      styleReferenceImageIds: [],
    });
  });

  it('lets the defaults decide the look and the closing', () => {
    const profile = applyNewProjectDefaults('short', custom).presentationProfile;
    for (const key of NEW_PROJECT_DEFAULT_PROFILE_KEYS) expect(profile[key]).toEqual(custom[key]);
  });

  it('follows the purpose for items left as "用途に合わせる"', () => {
    const follow: NewProjectDefaults = {
      ...custom,
      ttsNarrationStylePreset: null,
      sourceDisplayMode: null,
      closingCardHeadline: '  ',
    };
    const short = applyNewProjectDefaults('short', follow).presentationProfile;
    expect(short.ttsNarrationStylePreset).toBe('casual');
    expect(short.sourceDisplayMode).toBe('hidden');
    expect(short.closingCardHeadline).toBe('また次回もご覧ください');
    const news = applyNewProjectDefaults('news', follow).presentationProfile;
    expect(news.ttsNarrationStylePreset).toBe('news');
    expect(news.sourceDisplayMode).toBe('auto');
    expect(news.closingCardHeadline).toBe('ご視聴ありがとうございました');
  });
});

describe('withNewProjectDefaults', () => {
  it('replaces only the look and closing items of an existing video', () => {
    const existing = {
      ...purposeProfile('explain'),
      aspectRatio: '1:1' as const,
      targetDurationPerPartSec: 45,
      styleReferenceImageIds: ['11111111-1111-4111-8111-111111111111'],
      imageStylePreset: 'minimal' as const,
    };
    const next = withNewProjectDefaults(existing, {
      ...DEFAULT_NEW_PROJECT_DEFAULTS,
      imageStylePreset: 'dataCard',
      sourceDisplayMode: 'hidden',
    });
    expect(next).toEqual({
      ...existing,
      imageStylePreset: 'dataCard',
      sourceDisplayMode: 'hidden',
    });
  });
});
