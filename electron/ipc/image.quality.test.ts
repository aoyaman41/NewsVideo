import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { GEMINI_IMAGE_MODELS } from '../../shared/constants/models';
import { IMAGE_TEXT_RULE, IMAGE_TEXT_RULE_WITHOUT_SECTION } from '../../shared/project/imageText';
import type { ImageAsset } from '../../src/schemas';

// M3: 解像度と品質の対応付け、画像に描く文字のルール、Gemini の実寸の記録
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  openaiGenerate: vi.fn(),
  geminiGenerate: vi.fn(),
  settings: { imageModel: 'gpt-image-2.5-sunburst', imageResolution: 'fhd' },
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/tmp/test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: () => JSON.stringify({ openai: 'test-openai', google_ai: 'test-google' }),
  },
  nativeImage: {},
}));
vi.mock('openai', () => ({
  default: class {
    images = { generate: mocks.openaiGenerate };
  },
  toFile: vi.fn(),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.geminiGenerate };
  },
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith('settings.json')) return JSON.stringify(mocks.settings);
    if (path.endsWith('project.json')) return JSON.stringify({ id: 'project' });
    return Buffer.from('encrypted');
  }),
  readdir: vi.fn(async () => [{ name: 'test.newsproj', isDirectory: () => true }]),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(async () => ({ size: 42 })),
}));

const ipcEvent = { senderFrame: { url: 'http://localhost:5173', parent: null } };
const NEW_FORMAT_PROMPT = [
  'リッチニューススライド仕様',
  '画面に描く文字:',
  '- 見出し:「新しい橋が開通」',
  'オブジェクト配置:',
  '- 1: headline / top-center / large / 主情報 / 見出しを大きく配置',
].join('\n');
const prompt = {
  id: 'prompt',
  partId: 'part',
  prompt: NEW_FORMAT_PROMPT,
  stylePreset: 'infographic',
  aspectRatio: '16:9',
  version: 0,
  createdAt: '2026-09-26T00:00:00Z',
};

// 幅・高さだけを持つ最小の PNG ヘッダ(IHDR)
function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function geminiImageResponse(data: Buffer) {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: data.toString('base64'), mimeType: 'image/png' } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1120, totalTokenCount: 1220 },
  };
}

function generate(): Promise<ImageAsset> {
  return mocks.handlers.get('image:generate')!(ipcEvent, prompt, 'project') as Promise<ImageAsset>;
}

function countOccurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

beforeAll(async () => {
  await import('./image');
});

beforeEach(() => {
  mocks.openaiGenerate.mockReset();
  mocks.geminiGenerate.mockReset();
  mocks.settings = { imageModel: 'gpt-image-2.5-sunburst', imageResolution: 'fhd' };
  mocks.openaiGenerate.mockResolvedValue({
    data: [{ b64_json: 'aW1hZ2U=' }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
});

it.each([
  ['fhd', 'medium', '1792x1008'],
  ['2k', 'medium', '2560x1440'],
  ['4k', 'high', '3840x2160'],
] as const)('requests GPT Image at %s with %s quality', async (resolution, quality, size) => {
  mocks.settings.imageResolution = resolution;

  await generate();

  expect(mocks.openaiGenerate).toHaveBeenCalledWith(expect.objectContaining({ quality, size }));
});

it('states the on-screen text rule once and drops the long negative list', async () => {
  await generate();

  const sent = (mocks.openaiGenerate.mock.calls[0][0] as { prompt: string }).prompt;
  expect(countOccurrences(sent, IMAGE_TEXT_RULE)).toBe(1);
  expect(countOccurrences(sent, 'この文字列以外は描かない')).toBe(1);
  expect(sent).toContain('禁止:\n人物, 顔, 手, ロゴ, 透かし, QRコード');
  expect(sent).toContain('- 見出し:「新しい橋が開通」');
  for (const legacyTerm of ['画面コピー', '画面テキスト', '描画ルール', 'フォトリアル']) {
    expect(sent).not.toContain(legacyTerm);
  }
});

it('upgrades a saved legacy on-screen copy section to the quoted format', async () => {
  const legacyPrompt = [
    'リッチニューススライド仕様',
    '画面コピー:',
    '- 見出し: 新しい橋が開通',
    '- 要点1: 通勤時間が短縮',
    'オブジェクト配置:',
    '- 1: headline / top-center / large / 主情報 / 見出しを大きく配置',
  ].join('\n');

  await mocks.handlers.get('image:generate')!(
    ipcEvent,
    { ...prompt, prompt: legacyPrompt },
    'project'
  );

  const sent = (mocks.openaiGenerate.mock.calls[0][0] as { prompt: string }).prompt;
  expect(sent).toContain(
    '画面に描く文字:\n- 見出し:「新しい橋が開通」\n- 要点1:「通勤時間が短縮」'
  );
  expect(sent).not.toContain('画面コピー');
  expect(countOccurrences(sent, IMAGE_TEXT_RULE)).toBe(1);
});

it('uses the relaxed text rule for prompts without the text section', async () => {
  const legacyFallbackPrompt = [
    'スライド仕様',
    '主題: 新しい橋の開通',
    'テキスト: 見出し・ラベル・数値のみ。長文禁止',
  ].join('\n');

  await mocks.handlers.get('image:generate')!(
    ipcEvent,
    { ...prompt, prompt: legacyFallbackPrompt },
    'project'
  );

  const sent = (mocks.openaiGenerate.mock.calls[0][0] as { prompt: string }).prompt;
  expect(countOccurrences(sent, IMAGE_TEXT_RULE_WITHOUT_SECTION)).toBe(1);
  expect(sent).not.toContain(IMAGE_TEXT_RULE);
});

it('generates Gemini images at 2K for Full HD and records the actual image size', async () => {
  mocks.settings = { imageModel: GEMINI_IMAGE_MODELS[0], imageResolution: 'fhd' };
  mocks.geminiGenerate.mockResolvedValue(geminiImageResponse(pngHeader(2752, 1536)));

  const asset = await generate();

  const request = mocks.geminiGenerate.mock.calls[0][0] as {
    config: { imageConfig: { imageSize: string }; systemInstruction: string };
  };
  expect(request.config.imageConfig.imageSize).toBe('2K');
  expect(countOccurrences(request.config.systemInstruction, IMAGE_TEXT_RULE)).toBe(1);
  expect(asset.metadata).toMatchObject({
    width: 2752,
    height: 1536,
    generation: { resolution: 'fhd', imageSizeTier: '2K' },
  });
});

it('keeps 4K for Gemini and falls back to the requested size when the header is unreadable', async () => {
  mocks.settings = { imageModel: GEMINI_IMAGE_MODELS[0], imageResolution: '4k' };
  mocks.geminiGenerate.mockResolvedValue(geminiImageResponse(Buffer.from('not an image')));

  const asset = await generate();

  const request = mocks.geminiGenerate.mock.calls[0][0] as {
    config: { imageConfig: { imageSize: string } };
  };
  expect(request.config.imageConfig.imageSize).toBe('4K');
  expect(asset.metadata).toMatchObject({ width: 3840, height: 2160 });
});
