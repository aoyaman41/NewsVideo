/** 提供終了した Gemini preview 版の画像モデル ID が保存されていても、GA 版の ID で生成すること */
import { beforeEach, expect, it, vi } from 'vitest';
import type { ImageAsset } from '../../src/schemas';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  generateContent: vi.fn(),
  openaiGenerate: vi.fn(),
  secrets: { google_ai: 'test-google' } as Record<string, string>,
  imageModel: 'gemini-3.1-flash-image-preview' as string | undefined,
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
    getPath: () => '/tmp/test',
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: () => JSON.stringify(mocks.secrets),
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));
vi.mock('openai', () => ({
  default: class {
    images = { generate: mocks.openaiGenerate };
  },
  toFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith('settings.json'))
      return JSON.stringify(
        mocks.imageModel === undefined
          ? { imageResolution: 'fhd' }
          : { imageModel: mocks.imageModel, imageResolution: 'fhd' }
      );
    if (path.endsWith('project.json')) return JSON.stringify({ id: 'project' });
    return Buffer.from('encrypted');
  }),
  readdir: vi.fn(async () => [{ name: 'test.newsproj', isDirectory: () => true }]),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(async () => ({ size: 42 })),
}));

const ipcEvent = { senderFrame: { url: 'http://localhost:5173', parent: null } };
const prompt = {
  id: 'prompt',
  partId: 'part',
  prompt: '図解',
  stylePreset: 'infographic',
  aspectRatio: '16:9',
  version: 0,
  createdAt: '2026-09-26T00:00:00Z',
};

beforeEach(async () => {
  mocks.generateContent.mockReset();
  mocks.openaiGenerate.mockReset();
  mocks.secrets = { google_ai: 'test-google' };
  await import('./image');
  mocks.generateContent.mockResolvedValue({
    candidates: [
      { content: { parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }] } },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290, totalTokenCount: 1300 },
  });
});

it.each([
  ['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image'],
  ['gemini-3-pro-image-preview', 'gemini-3-pro-image'],
])('generates with the GA model when settings still hold %s', async (saved, current) => {
  mocks.imageModel = saved;
  const asset = (await mocks.handlers.get('image:generate')!(
    ipcEvent,
    prompt,
    'project'
  )) as ImageAsset;
  expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: current }));
  // GA 版でも画像サイズと縦横比の指定方法は preview 版と同じ(imageConfig.imageSize / aspectRatio)
  expect(mocks.generateContent.mock.calls[0][0]).toMatchObject({
    config: { imageConfig: { aspectRatio: '16:9', imageSize: expect.any(String) } },
  });
  expect(asset.metadata.generation?.model).toBe(current);
  expect(mocks.openaiGenerate).not.toHaveBeenCalled();
});

it('uses the new default GPT Image 2.5 Sunburst when no image model is saved', async () => {
  mocks.imageModel = undefined;
  mocks.secrets = { openai: 'test-openai' };
  mocks.openaiGenerate.mockResolvedValue({
    data: [{ b64_json: 'aW1hZ2U=' }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  await mocks.handlers.get('image:generate')!(ipcEvent, prompt, 'project');
  expect(mocks.openaiGenerate).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'gpt-image-2.5-sunburst' })
  );
  expect(mocks.generateContent).not.toHaveBeenCalled();
});
