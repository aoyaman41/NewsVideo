import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  generate: vi.fn(),
  secrets: { openai: 'test-openai' } as Record<string, string>,
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
  app: { getPath: () => '/tmp/test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: () => JSON.stringify(mocks.secrets),
  },
}));
vi.mock('../utils/openaiImage', () => ({ generateOpenAIImage: mocks.generate }));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith('settings.json'))
      return JSON.stringify({ imageModel: 'gpt-image-2', imageResolution: '2k' });
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
  await import('./image');
  mocks.generate.mockResolvedValue({
    base64Data: 'aW1hZ2U=',
    width: 2560,
    height: 1440,
    inputTokens: 10,
    outputTokens: 20,
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
  const asset = await mocks.handlers.get('image:generate')!(null, prompt, 'project');
  expect(mocks.generate).toHaveBeenCalledWith('test-openai', expect.any(String), '16:9', '2k');
  expect(asset).toMatchObject({
    metadata: { width: 2560, generation: { model: 'gpt-image-2', inputTokens: 10 } },
  });
});

it('keeps successful batch assets when one request fails', async () => {
  mocks.generate.mockRejectedValueOnce(new Error('failed part'));
  const assets = await mocks.handlers.get('image:generateBatch')!(
    null,
    [prompt, { ...prompt, id: 'second' }],
    'project'
  );
  expect(assets).toHaveLength(1);
  expect(assets).toMatchObject([{ metadata: { promptId: 'second' } }]);
});

it('reports the OpenAI key requirement before generating', async () => {
  mocks.secrets = {};
  await expect(mocks.handlers.get('image:generate')!(null, prompt, 'project')).rejects.toThrow(
    'OpenAI APIキー'
  );
  expect(mocks.generate).not.toHaveBeenCalled();
});
