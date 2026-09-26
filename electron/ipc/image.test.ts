import { beforeEach, expect, it, vi } from 'vitest';
import { createImageUsageRecordFromAssets } from '../../src/utils/usage';
import type { ImageAsset } from '../../src/schemas';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  generate: vi.fn(),
  secrets: { openai: 'test-openai' } as Record<string, string>,
  imageModel: 'gpt-image-2',
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
}));
vi.mock('openai', () => ({
  default: class {
    images = { generate: mocks.generate };
  },
  toFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith('settings.json'))
      return JSON.stringify({ imageModel: mocks.imageModel, imageResolution: '2k' });
    if (path.endsWith('project.json')) return JSON.stringify({ id: 'project' });
    return Buffer.from('encrypted');
  }),
  readdir: vi.fn(async () => [{ name: 'test.newsproj', isDirectory: () => true }]),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(async () => ({ size: 42 })),
}));

beforeEach(async () => {
  mocks.generate.mockReset();
  mocks.secrets = { openai: 'test-openai' };
  mocks.imageModel = 'gpt-image-2';
  await import('./image');
  mocks.generate.mockResolvedValue({
    data: [{ b64_json: 'aW1hZ2U=' }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
});

const prompt = {
  id: 'prompt',
  partId: 'part',
  prompt: '図解',
  stylePreset: 'infographic',
  aspectRatio: '16:9',
  version: 0,
  createdAt: '2026-09-05T00:00:00Z',
};

it('routes individual image generation through OpenAI without a Google key', async () => {
  const asset = await mocks.handlers.get('image:generate')!(
    { senderFrame: { url: 'http://localhost:5173', parent: null } },
    prompt,
    'project'
  );
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'gpt-image-2', size: '2560x1440' })
  );
  expect(asset).toMatchObject({
    metadata: { width: 2560, generation: { model: 'gpt-image-2', inputTokens: 10 } },
  });
});

it('keeps successful batch assets when one request fails', async () => {
  mocks.generate.mockRejectedValueOnce(new Error('failed part'));
  const assets = await mocks.handlers.get('image:generateBatch')!(
    { senderFrame: { url: 'http://localhost:5173', parent: null } },
    [prompt, { ...prompt, id: 'second' }],
    'project'
  );
  expect(assets).toMatchObject({ images: expect.any(Array), errors: expect.any(Array) });
  expect(assets).toMatchObject({ images: [{ metadata: { promptId: 'second' } }] });
});

it('reports the OpenAI key requirement before generating', async () => {
  mocks.secrets = {};
  await expect(
    mocks.handlers.get('image:generate')!(
      { senderFrame: { url: 'http://localhost:5173', parent: null } },
      prompt,
      'project'
    )
  ).rejects.toThrow('OpenAI APIキー');
  expect(mocks.generate).not.toHaveBeenCalled();
});

const ipcEvent = { senderFrame: { url: 'http://localhost:5173', parent: null } };

it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'] as const)(
  'generates with %s through OpenAI and records that model in metadata and usage',
  async (model) => {
    mocks.imageModel = model;
    const asset = (await mocks.handlers.get('image:generate')!(
      ipcEvent,
      prompt,
      'project'
    )) as ImageAsset;
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    // サイズ・品質・形式は GPT Image 2 と同じ(2K: 2560x1440 / medium / png)
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        size: '2560x1440',
        quality: 'medium',
        output_format: 'png',
      })
    );
    expect(asset).toMatchObject({
      metadata: {
        width: 2560,
        height: 1440,
        generation: { model, resolution: '2k', inputTokens: 10, outputTokens: 20 },
      },
    });
    expect(createImageUsageRecordFromAssets([asset], 'image_generate')).toMatchObject({
      provider: 'openai',
      category: 'image',
      model,
      inputTokens: 10,
      outputTokens: 20,
      imageCount: 1,
    });
  }
);

it('uses the selected GPT Image 2.5 model for every batch request', async () => {
  mocks.imageModel = 'gpt-image-2.5-flare';
  const result = (await mocks.handlers.get('image:generateBatch')!(
    ipcEvent,
    [prompt, { ...prompt, id: 'second' }],
    'project'
  )) as { images: ImageAsset[] };
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  for (const [request] of mocks.generate.mock.calls) {
    expect(request).toMatchObject({ model: 'gpt-image-2.5-flare' });
  }
  expect(result.images.map((image) => image.metadata.generation?.model)).toEqual([
    'gpt-image-2.5-flare',
    'gpt-image-2.5-flare',
  ]);
});

it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'] as const)(
  'reports the OpenAI key requirement for %s before generating',
  async (model) => {
    mocks.imageModel = model;
    mocks.secrets = { google_ai: 'test-google' };
    await expect(
      mocks.handlers.get('image:generate')!(ipcEvent, prompt, 'project')
    ).rejects.toThrow('OpenAI APIキー');
    expect(mocks.generate).not.toHaveBeenCalled();
  }
);
