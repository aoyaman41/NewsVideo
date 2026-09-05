import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateOpenAIImage, getOpenAIImageDimensions } from './openaiImage';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    images = { generate };
  },
}));

describe('GPT Image 2 requests', () => {
  beforeEach(() => generate.mockReset());

  it('keeps every size within API limits and preserves aspect ratios', () => {
    for (const resolution of ['fhd', '2k', '4k'] as const) {
      for (const ratio of ['16:9', '1:1', '9:16'] as const) {
        const { width, height } = getOpenAIImageDimensions(ratio, resolution);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
        expect(width * height).toBeGreaterThanOrEqual(655360);
        expect(width * height).toBeLessThanOrEqual(8294400);
        const [x, y] = ratio.split(':').map(Number);
        expect(width / height).toBeCloseTo(x / y);
      }
    }
  });

  it('uses Images API parameters and retains usage', async () => {
    generate.mockResolvedValue({
      data: [{ b64_json: 'png-data' }],
      usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
    });
    const result = await generateOpenAIImage('test-key', 'test prompt', '9:16', '4k');
    expect(generate).toHaveBeenCalledWith({
      model: 'gpt-image-2',
      prompt: 'test prompt',
      n: 1,
      size: '2160x3840',
      quality: 'auto',
      output_format: 'png',
    });
    expect(result).toMatchObject({
      base64Data: 'png-data',
      width: 2160,
      height: 3840,
      inputTokens: 100,
      outputTokens: 200,
    });
  });

  it('rejects empty images without fabricating an asset', async () => {
    generate.mockResolvedValue({ data: [] });
    await expect(generateOpenAIImage('test-key', 'test', '1:1', 'fhd')).rejects.toThrow(
      '画像データ'
    );
  });
});
