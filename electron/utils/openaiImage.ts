import OpenAI from 'openai';
import type { ImageResolution } from '../../shared/constants/models';
import type { ImageAspectRatio } from '../../shared/project/imageStylePresets';

// GPT Image 2 requires 16px multiples and at most 8,294,400 pixels.
// Keep the exact project ratio; square 4K is limited to 2880px per edge.
export function getOpenAIImageDimensions(ratio: ImageAspectRatio, resolution: ImageResolution) {
  if (ratio === '1:1') {
    const edge = resolution === '4k' ? 2880 : resolution === '2k' ? 2560 : 1920;
    return { width: edge, height: edge };
  }
  const width = resolution === '4k' ? 3840 : resolution === '2k' ? 2560 : 1792;
  const height = (width * 9) / 16;
  return ratio === '9:16' ? { width: height, height: width } : { width, height };
}

export async function generateOpenAIImage(
  apiKey: string,
  prompt: string,
  ratio: ImageAspectRatio,
  resolution: ImageResolution
) {
  const dimensions = getOpenAIImageDimensions(ratio, resolution);
  const client = new OpenAI({ apiKey });
  // The SDK owns retries; do not wrap this request in the Gemini retry helper.
  const response = await client.images.generate({
    model: 'gpt-image-2',
    prompt,
    n: 1,
    size: `${dimensions.width}x${dimensions.height}`,
    quality: 'auto',
    output_format: 'png',
  });
  const base64Data = response.data?.[0]?.b64_json;
  if (!base64Data)
    throw new Error('画像生成に失敗しました: OpenAIから画像データが返されませんでした');
  return {
    base64Data,
    ...dimensions,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    totalTokens: response.usage?.total_tokens,
  };
}
