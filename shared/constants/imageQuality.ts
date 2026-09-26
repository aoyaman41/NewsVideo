import type { ImageModelProvider, ImageResolution, ImageSizeTier } from './models';

/**
 * Gemini に送る imageSize。Full HD 相当でも文字が読めるよう 2K で生成する
 * (Gemini 3 Pro Image は 1K と 2K が同額。3.1 Flash Image は 2K のほうが高い)。
 */
export function getGeminiImageSizeTier(resolution: ImageResolution): ImageSizeTier {
  return resolution === '4k' ? '4K' : '2K';
}

/** GPT Image の quality。Full HD 相当と 2K 相当は medium、4K 相当は high */
export function getOpenAIImageQuality(resolution: ImageResolution): 'medium' | 'high' {
  return resolution === '4k' ? 'high' : 'medium';
}

/**
 * 画像メタデータと見積もりに記録するサイズ区分。
 * Gemini は実際に要求する imageSize、GPT Image は解像度の区分(料金はトークンで計算する)。
 */
export function getImageSizeTier(
  provider: ImageModelProvider,
  resolution: ImageResolution
): ImageSizeTier {
  if (provider === 'gemini') return getGeminiImageSizeTier(resolution);
  return resolution === '4k' ? '4K' : resolution === '2k' ? '2K' : '1K';
}
