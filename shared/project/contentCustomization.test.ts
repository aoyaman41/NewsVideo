import { describe, expect, it } from 'vitest';
import {
  CONTENT_CUSTOMIZATION_BOUNDARIES,
  getContentCustomizationBoundariesByCategory,
} from './contentCustomization';

describe('CONTENT_CUSTOMIZATION_BOUNDARIES', () => {
  it('keeps the main phase-1 controls in the intended categories', () => {
    const closingLine = CONTENT_CUSTOMIZATION_BOUNDARIES.find((boundary) => boundary.id === 'closing_line');
    const imageStyle = CONTENT_CUSTOMIZATION_BOUNDARIES.find((boundary) => boundary.id === 'image_style');
    const narrationStyle = CONTENT_CUSTOMIZATION_BOUNDARIES.find(
      (boundary) => boundary.id === 'tts_narration_style'
    );
    const closingCard = CONTENT_CUSTOMIZATION_BOUNDARIES.find(
      (boundary) => boundary.id === 'closing_card'
    );
    const duration = CONTENT_CUSTOMIZATION_BOUNDARIES.find(
      (boundary) => boundary.id === 'target_duration_per_part_sec'
    );

    expect(closingLine?.category).toBe('preset_with_override');
    expect(imageStyle?.category).toBe('preset_only');
    expect(narrationStyle?.category).toBe('preset_with_override');
    expect(narrationStyle?.uiExposure).toBe('main');
    expect(closingCard?.category).toBe('preset_with_override');
    expect(closingCard?.uiExposure).toBe('details');
    expect(duration?.category).toBe('direct_setting');
  });

  it('exposes advanced-only items separately from main controls', () => {
    const advancedItems = getContentCustomizationBoundariesByCategory('advanced_only');

    expect(advancedItems.map((item) => item.id)).toEqual(
      expect.arrayContaining(['image_prompt_suffix', 'tts_prompt_guidance', 'layout_template'])
    );
    expect(advancedItems.every((item) => item.uiExposure === 'advanced')).toBe(true);
  });
});
