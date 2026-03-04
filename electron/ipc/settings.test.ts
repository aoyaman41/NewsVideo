import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const handlers = new Map<string, IpcHandler>();
const mockHandle = vi.fn((channel: string, handler: IpcHandler) => {
  handlers.set(channel, handler);
});

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const accessMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
  },
  app: {
    getPath: vi.fn(() => '/tmp/newsvideo-test'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: vi.fn(() => JSON.stringify({})),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  access: accessMock,
}));

async function loadSettingsModule(): Promise<void> {
  handlers.clear();
  mockHandle.mockClear();
  readFileMock.mockReset();
  writeFileMock.mockReset();
  accessMock.mockReset();
  vi.resetModules();
  await import('./settings');
}

function getHandler(channel: string): IpcHandler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler not found: ${channel}`);
  }
  return handler;
}

describe('settings IPC handlers', () => {
  beforeEach(async () => {
    await loadSettingsModule();
  });

  it('registers expected channels', () => {
    expect(handlers.has('settings:get')).toBe(true);
    expect(handlers.has('settings:set')).toBe(true);
    expect(handlers.has('settings:getApiKey')).toBe(true);
    expect(handlers.has('settings:setApiKey')).toBe(true);
    expect(handlers.has('settings:testConnection')).toBe(true);
  });

  it('normalizes invalid persisted settings in settings:get', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        ttsEngine: 'google_tts',
        ttsVoice: 'ja-JP-Chirp3-HD-Aoife',
        scriptTextModel: 'invalid-model',
        imagePromptTextModel: 'invalid-model',
        imageModel: 'invalid-model',
        imageResolution: 'invalid-resolution',
        cost: { openai: { inputPer1MTokensUsd: 1 } },
      })
    );

    const handler = getHandler('settings:get');
    const result = (await handler({})) as typeof DEFAULT_SETTINGS & { cost?: unknown };

    expect(result.ttsEngine).toBe('gemini_tts');
    expect(result.ttsVoice).toBe(DEFAULT_SETTINGS.ttsVoice);
    expect(result.scriptTextModel).toBe(DEFAULT_SETTINGS.scriptTextModel);
    expect(result.imagePromptTextModel).toBe(DEFAULT_SETTINGS.imagePromptTextModel);
    expect(result.imageModel).toBe(DEFAULT_SETTINGS.imageModel);
    expect(result.imageResolution).toBe(DEFAULT_SETTINGS.imageResolution);
    expect(result.cost).toEqual({ openai: { inputPer1MTokensUsd: 1 } });
  });

  it('rejects invalid payload in settings:set', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify(DEFAULT_SETTINGS));
    const handler = getHandler('settings:set');

    await expect(handler({}, { videoFps: 'fast' })).rejects.toThrow();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('writes normalized and stripped payload in settings:set', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify(DEFAULT_SETTINGS));
    writeFileMock.mockResolvedValueOnce(undefined);

    const handler = getHandler('settings:set');
    await handler({}, { imageModel: 'gemini-3-pro-image-preview', ttsEngine: 'google_tts', unknown: true });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [settingsPath, content] = writeFileMock.mock.calls[0];
    expect(settingsPath).toBe('/tmp/newsvideo-test/settings.json');

    const saved = JSON.parse(String(content));
    expect(saved.imageModel).toBe('gemini-3-pro-image-preview');
    expect(saved.ttsEngine).toBe('gemini_tts');
    expect(saved.unknown).toBeUndefined();
  });
});
