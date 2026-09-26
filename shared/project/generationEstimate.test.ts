import { describe, expect, it } from 'vitest';
import { GEMINI_IMAGE_MODELS } from '../constants/models';
import { DEFAULT_SETTINGS, type AppSettings } from '../settings/appSettings';
import { estimateGenerationUsd } from './generationEstimate';

// M3: 見積もりは実際に生成するサイズ区分に合わせる
describe('estimateGenerationUsd for images', () => {
  const gemini = (imageResolution: AppSettings['imageResolution']): AppSettings => ({
    ...DEFAULT_SETTINGS,
    imageModel: GEMINI_IMAGE_MODELS[0],
    imageResolution,
  });
  const openai = (imageResolution: AppSettings['imageResolution']): AppSettings => ({
    ...DEFAULT_SETTINGS,
    imageModel: 'gpt-image-2.5-sunburst',
    imageResolution,
  });

  it('estimates Gemini Full HD the same as 2K because both generate at 2K', () => {
    expect(estimateGenerationUsd('image', '図解', gemini('fhd'))).toBeCloseTo(
      estimateGenerationUsd('image', '図解', gemini('2k')),
      10
    );
    expect(estimateGenerationUsd('image', '図解', gemini('4k'))).toBeGreaterThan(
      estimateGenerationUsd('image', '図解', gemini('2k'))
    );
  });

  it('keeps separate GPT Image estimates for Full HD and 2K', () => {
    expect(estimateGenerationUsd('image', '図解', openai('fhd'))).toBeLessThan(
      estimateGenerationUsd('image', '図解', openai('2k'))
    );
  });
});
