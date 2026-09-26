import { describe, expect, it } from 'vitest';
import { LEGACY_IMAGE_STYLE_PRESET_ALIASES, migrateLegacyProjectData } from './legacyMigration';
import { IMAGE_STYLE_PRESETS } from './imageStylePresets';

describe('migrateLegacyProjectData', () => {
  // 2026-03 の c3bf32f で infographic の別名として扱っていた旧値(実装の表とは独立に列挙する)
  it.each(['news_broadcast', 'news_panel', 'documentary', 'photorealistic', 'illustration'])(
    'reads the retired image style %s as infographic',
    (legacy) => {
      const data = {
        prompts: [{ id: 'a', stylePreset: legacy }],
        presentationProfile: { imageStylePreset: legacy, aspectRatio: '16:9' },
      };
      const migrated = migrateLegacyProjectData(data);
      expect(migrated.prompts[0].stylePreset).toBe('infographic');
      expect(migrated.presentationProfile.imageStylePreset).toBe('infographic');
      expect(migrated.presentationProfile.aspectRatio).toBe('16:9');
      // 入力は変更しない
      expect(data.prompts[0].stylePreset).toBe(legacy);
    }
  );

  it('only maps retired values to presets that still exist', () => {
    for (const preset of Object.values(LEGACY_IMAGE_STYLE_PRESET_ALIASES))
      expect(IMAGE_STYLE_PRESETS).toContain(preset);
  });

  it('returns the same object when nothing needs migrating', () => {
    const data = {
      prompts: [{ stylePreset: 'editorial' }, { stylePreset: 'dataCard' }],
      presentationProfile: { imageStylePreset: 'minimal' },
    };
    expect(migrateLegacyProjectData(data)).toBe(data);
    expect(migrateLegacyProjectData(null)).toBeNull();
    expect(migrateLegacyProjectData('text')).toBe('text');
  });

  it('keeps unknown values so that schema validation still reports real corruption', () => {
    const data = { prompts: [{ stylePreset: 'not_a_preset' }, null, 'broken'] };
    expect(migrateLegacyProjectData(data)).toBe(data);
  });

  it('migrates only the prompts that use a retired value', () => {
    const current = { stylePreset: 'social' };
    const migrated = migrateLegacyProjectData({
      prompts: [current, { stylePreset: 'news_panel' }],
    });
    expect(migrated.prompts[0]).toBe(current);
    expect(migrated.prompts[1]).toEqual({ stylePreset: 'infographic' });
  });
});
