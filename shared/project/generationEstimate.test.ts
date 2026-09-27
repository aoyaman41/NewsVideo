import { describe, expect, it } from 'vitest';
import { GEMINI_IMAGE_MODELS } from '../constants/models';
import { DEFAULT_SETTINGS, type AppSettings } from '../settings/appSettings';
import {
  BUDGET_RESERVE_MULTIPLIER,
  ESTIMATE_UPPER_MULTIPLIER,
  estimateGenerationUsd,
  estimateProjectGeneration,
  estimatedOpenAIImageOutputTokens,
} from './generationEstimate';
import { createNewProject } from './schema';

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

  // M5: 画像の想定トークンを実測に合わせた(以前は 4K で 32,000 と想定し、実測の約 10 倍だった)
  it('uses the measured output tokens of GPT Image 2.5 Sunburst at 4K (high)', () => {
    expect(estimatedOpenAIImageOutputTokens('gpt-image-2.5-sunburst', '4K', 'high')).toBe(3336);
    // 入力 1,500 × $5 + 出力 3,336 × $30(100 万トークンあたり)
    expect(estimateGenerationUsd('image', '図解', openai('4k'))).toBeCloseTo(
      (1500 * 5 + 3336 * 30) / 1_000_000,
      10
    );
  });

  it('prices Gemini images per image with the official price instead of output tokens', () => {
    // 3.1 Flash Image: 2K は 1 枚 $0.101(入力は $0.50 / 100 万トークン)
    expect(estimateGenerationUsd('image', '図解', gemini('fhd'))).toBeCloseTo(
      0.101 + (1500 * 0.5) / 1_000_000,
      10
    );
    // 3 Pro Image: 4K は 1 枚 $0.24(入力は $2 / 100 万トークン)
    expect(
      estimateGenerationUsd('image', '図解', {
        ...gemini('4k'),
        imageModel: 'gemini-3-pro-image',
      })
    ).toBeCloseTo(0.24 + (1500 * 2) / 1_000_000, 10);
  });
});

describe('estimateGenerationUsd for text and audio (M5)', () => {
  const claude: AppSettings = { ...DEFAULT_SETTINGS };

  it('expects about 450 output tokens per scene for the script', () => {
    const article = '文'.repeat(900);
    expect(estimateGenerationUsd('script', article, claude, 5)).toBeCloseTo(
      ((900 / 1.5 + 1500) * 4 + 450 * 5 * 20) / 1_000_000,
      10
    );
  });

  it('expects the article plus 1,500 tokens in and 1,500 tokens out for an image prompt', () => {
    const article = '文'.repeat(900);
    expect(estimateGenerationUsd('prompt', article, claude)).toBeCloseTo(
      ((900 / 1.5 + 1500) * 4 + 1500 * 20) / 1_000_000,
      10
    );
  });

  it('keeps the audio estimate calibrated to about 6 output tokens per character', () => {
    const text = '文'.repeat(120);
    expect(estimateGenerationUsd('audio', text, claude)).toBeCloseTo(
      (80 * 0.5 + 750 * 9) / 1_000_000,
      10
    );
  });

  it('shows "about X (at most X × 1.3)" and reserves X × 1.5 per request', () => {
    expect(ESTIMATE_UPPER_MULTIPLIER).toBe(1.3);
    expect(BUDGET_RESERVE_MULTIPLIER).toBe(1.5);
  });
});

/**
 * 手元の実績(2026-09、ユーザーデータから本文の長さと実績の金額だけを写した)と比べる。
 * 設定: 台本・画像の指示 = Claude Opus 5.5、画像 = GPT Image 2.5 Sunburst 4K、音声 = Gemini 3.8 Flash TTS。
 * 統合時の確認項目(±30% 以内)をここでも確かめる。
 */
describe('estimateProjectGeneration against measured jobs', () => {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    imageModel: 'gpt-image-2.5-sunburst',
    imageResolution: '4k',
    ttsModel: 'gemini-3.8-flash-tts',
  };
  const measured = [
    // b3e9698d: 3 シーン、本文 848 文字、実績 $0.5132(台本 0.0194・画像の指示 0.1493・画像 0.3247・音声 0.0198)
    { name: '3 scenes (b3e9698d)', bodyLength: 848, scenes: 3, actualUsd: 0.5132 },
    // 飯田橋: 5 シーン、本文 595 文字、実績 $0.7150(台本 0.0507・画像の指示 0.1053・画像 0.5257・音声 0.0333)
    { name: '5 scenes (飯田橋)', bodyLength: 595, scenes: 5, actualUsd: 0.715 },
  ];

  for (const job of measured) {
    it(`is within ±30% of the actual cost for ${job.name}`, () => {
      const project = createNewProject('実績', '');
      project.article = {
        ...project.article,
        title: '記事',
        bodyText: '文'.repeat(job.bodyLength),
      };
      project.presentationProfile.targetDurationPerPartSec = 30;
      const quote = estimateProjectGeneration(project, settings, job.scenes);
      expect(Math.abs(quote.usd - job.actualUsd) / job.actualUsd).toBeLessThan(0.3);
      expect(quote.upperUsd).toBeCloseTo(quote.usd * 1.3, 10);
      expect(quote.steps.map((step) => [step.kind, step.count])).toEqual([
        ['script', 1],
        ['prompt', job.scenes],
        ['image', job.scenes],
        ['audio', job.scenes],
      ]);
    });
  }

  it('reserves far less than the default $5 budget even for 5 scenes at 4K', () => {
    const project = createNewProject('予算', '');
    project.article = { ...project.article, title: '記事', bodyText: '文'.repeat(3000) };
    const quote = estimateProjectGeneration(project, settings, 5);
    expect(quote.usd * BUDGET_RESERVE_MULTIPLIER).toBeLessThan(2);
  });
});
