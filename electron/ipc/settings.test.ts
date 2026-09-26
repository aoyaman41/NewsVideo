import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const repositoryMock = vi.hoisted(() => ({
  directories: vi.fn(async () => [] as string[]),
  readDirectory: vi.fn(),
  update: vi.fn(),
}));
vi.mock('./project', () => ({ getProjectRepository: () => repositoryMock }));

const handlers = new Map<string, IpcHandler>();
const mockHandle = vi.fn((channel: string, handler: IpcHandler) => {
  handlers.set(channel, handler);
});

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const accessMock = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: mockHandle,
  },
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
    getPath: vi.fn(() => '/tmp/newsvideo-test'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: vi.fn(() => JSON.stringify({})),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  access: accessMock,
}));

const anthropicMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class MockAnthropic {
    static APIError = actual.APIError;
    models = { retrieve: anthropicMocks.retrieve };
    constructor(options: unknown) {
      anthropicMocks.construct(options);
    }
  }
  return { ...actual, default: MockAnthropic };
});

async function loadSettingsModule(): Promise<void> {
  repositoryMock.directories.mockReset().mockResolvedValue([]);
  repositoryMock.readDirectory.mockReset();
  repositoryMock.update.mockReset();
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
    expect(handlers.has('settings:hasApiKey')).toBe(true);
    expect(handlers.has('settings:setApiKey')).toBe(true);
    expect(handlers.has('settings:testConnection')).toBe(true);
  });

  it('normalizes invalid persisted settings in settings:get', async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        ttsEngine: 'google_tts',
        ttsVoice: 'ja-JP-Chirp3-HD-Aoife',
        ttsModel: 'invalid-model',
        scriptTextModel: 'invalid-model',
        imagePromptTextModel: 'invalid-model',
        openaiReasoningEffort: 'invalid-effort',
        geminiThinkingLevel: 'invalid-level',
        imageModel: 'invalid-model',
        imageResolution: 'invalid-resolution',
        cost: { openai: { inputPer1MTokensUsd: 1 } },
      })
    );

    const handler = getHandler('settings:get');
    const result = (await handler({
      senderFrame: { url: 'http://localhost:5173', parent: null },
    })) as typeof DEFAULT_SETTINGS & { cost?: unknown };

    expect(result.ttsEngine).toBe('gemini_tts');
    expect(result.ttsVoice).toBe(DEFAULT_SETTINGS.ttsVoice);
    expect(result.ttsModel).toBe(DEFAULT_SETTINGS.ttsModel);
    expect(result.scriptTextModel).toBe(DEFAULT_SETTINGS.scriptTextModel);
    expect(result.imagePromptTextModel).toBe(DEFAULT_SETTINGS.imagePromptTextModel);
    expect(result.openaiReasoningEffort).toBe(DEFAULT_SETTINGS.openaiReasoningEffort);
    expect(result.geminiThinkingLevel).toBe(DEFAULT_SETTINGS.geminiThinkingLevel);
    expect(result.imageModel).toBe(DEFAULT_SETTINGS.imageModel);
    expect(result.imageResolution).toBe(DEFAULT_SETTINGS.imageResolution);
    expect(result.cost).toEqual({ openai: { inputPer1MTokensUsd: 1 } });
  });

  it('rejects invalid payload in settings:set', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify(DEFAULT_SETTINGS));
    const handler = getHandler('settings:set');

    await expect(
      handler({ senderFrame: { url: 'http://localhost:5173', parent: null } }, { videoFps: 'fast' })
    ).rejects.toThrow();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('writes normalized and stripped payload in settings:set', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify(DEFAULT_SETTINGS));
    writeFileMock.mockResolvedValueOnce(undefined);

    const handler = getHandler('settings:set');
    await handler(
      { senderFrame: { url: 'http://localhost:5173', parent: null } },
      {
        scriptTextModel: 'gpt-5.6-terra',
        imagePromptTextModel: 'gpt-5.6-luna',
        imageModel: 'gemini-3-pro-image-preview',
        ttsEngine: 'google_tts',
        ttsModel: 'gemini-2.5-flash-preview-tts',
        openaiReasoningEffort: 'max',
        geminiThinkingLevel: 'low',
        unknown: true,
      }
    );

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [settingsPath, content] = writeFileMock.mock.calls[0];
    expect(settingsPath).toBe('/tmp/newsvideo-test/settings.json');

    const saved = JSON.parse(String(content));
    expect(saved.scriptTextModel).toBe('gpt-5.6-terra');
    expect(saved.imagePromptTextModel).toBe('gpt-5.6-luna');
    // 提供終了した preview 版の ID は GA 版の ID で保存される
    expect(saved.imageModel).toBe('gemini-3-pro-image');
    expect(saved.ttsEngine).toBe('gemini_tts');
    expect(saved.openaiReasoningEffort).toBe('max');
    expect(saved.ttsModel).toBe('gemini-2.5-flash-preview-tts');
    expect(saved.geminiThinkingLevel).toBe('low');
    expect(saved.unknown).toBeUndefined();
  });
});

describe('Anthropic settings', () => {
  const event = { senderFrame: { url: 'http://localhost:5173', parent: null } };

  beforeEach(async () => {
    anthropicMocks.construct.mockReset();
    anthropicMocks.retrieve.mockReset();
    await loadSettingsModule();
  });

  it('allows the anthropic key for renderer key operations but keeps other services blocked', async () => {
    await expect(getHandler('settings:hasApiKey')(event, 'anthropic')).resolves.toBe(false);
    await expect(getHandler('settings:hasApiKey')(event, 'google_tts')).rejects.toThrow(
      '未対応のサービスです。'
    );

    writeFileMock.mockResolvedValueOnce(undefined);
    await expect(
      getHandler('settings:setApiKey')(event, 'anthropic', 'test-anthropic-key')
    ).resolves.toEqual({ success: true });
    const [secretsPath, encrypted] = writeFileMock.mock.calls[0];
    expect(secretsPath).toBe('/tmp/newsvideo-test/secrets.enc');
    expect(JSON.parse(String(encrypted))).toEqual({ anthropic: 'test-anthropic-key' });
  });

  it('tests the Anthropic connection through the SDK models endpoint for Opus 5.5', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    anthropicMocks.retrieve.mockResolvedValueOnce({ id: 'claude-opus-5-5' });

    const result = await getHandler('settings:testConnection')(event, 'anthropic', 'test-key');

    expect(result).toMatchObject({ success: true, message: '接続成功' });
    expect(anthropicMocks.construct).toHaveBeenCalledWith({
      apiKey: 'test-key',
      authToken: null,
      maxRetries: 0,
    });
    expect(anthropicMocks.retrieve).toHaveBeenCalledWith('claude-opus-5-5');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('formats Anthropic API failures like the other providers', async () => {
    const { AuthenticationError, APIConnectionError } =
      await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
    anthropicMocks.retrieve.mockRejectedValueOnce(
      new AuthenticationError(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        undefined,
        new Headers()
      )
    );
    await expect(
      getHandler('settings:testConnection')(event, 'anthropic', 'bad-key')
    ).resolves.toMatchObject({ success: false, message: '接続失敗: 401 invalid x-api-key' });

    anthropicMocks.retrieve.mockRejectedValueOnce(new APIConnectionError({}));
    await expect(
      getHandler('settings:testConnection')(event, 'anthropic', 'test-key')
    ).resolves.toMatchObject({ success: false, message: '接続エラー: Connection error.' });
  });

  it('reports a missing Anthropic key without calling the API', async () => {
    const result = await getHandler('settings:testConnection')(event, 'anthropic');

    expect(result).toEqual({ success: false, message: 'APIキーが設定されていません' });
    expect(anthropicMocks.retrieve).not.toHaveBeenCalled();
  });

  it('persists claudeEffort and propagates it to idle projects', async () => {
    // 既定のテキストモデルは Claude なので、旧来の OpenAI モデルを保存済みの設定から切り替える
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ ...DEFAULT_SETTINGS, scriptTextModel: 'gpt-5.2' })
    );
    repositoryMock.directories.mockResolvedValue(['/idle']);
    repositoryMock.readDirectory.mockResolvedValueOnce({ id: 'idle' });
    const project = { id: 'idle', revision: 1, generationConfig: {} };
    repositoryMock.update.mockImplementation(async (_id, mutate) => {
      mutate(project);
      return project;
    });

    await getHandler('settings:set')(event, {
      scriptTextModel: 'claude-opus-5-5',
      claudeEffort: 'max',
    });

    const saved = JSON.parse(String(writeFileMock.mock.calls[0][1]));
    expect(saved).toMatchObject({ scriptTextModel: 'claude-opus-5-5', claudeEffort: 'max' });
    expect(project.generationConfig).toEqual({
      scriptTextModel: 'claude-opus-5-5',
      claudeEffort: 'max',
    });
  });

  it('persists the image prompt effort separately and propagates it to idle projects', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify(DEFAULT_SETTINGS));
    repositoryMock.directories.mockResolvedValue(['/idle']);
    repositoryMock.readDirectory.mockResolvedValueOnce({ id: 'idle' });
    const project = { id: 'idle', revision: 1, generationConfig: {} };
    repositoryMock.update.mockImplementation(async (_id, mutate) => {
      mutate(project);
      return project;
    });

    await getHandler('settings:set')(event, { claudeImagePromptEffort: 'low' });

    const saved = JSON.parse(String(writeFileMock.mock.calls[0][1]));
    expect(saved).toMatchObject({ claudeEffort: 'medium', claudeImagePromptEffort: 'low' });
    expect(project.generationConfig).toEqual({ claudeImagePromptEffort: 'low' });
  });
});

it('propagates only changed generation defaults and leaves running job snapshots intact', async () => {
  await loadSettingsModule();
  readFileMock.mockResolvedValueOnce(JSON.stringify(DEFAULT_SETTINGS));
  repositoryMock.directories.mockResolvedValue(['/idle', '/running']);
  repositoryMock.readDirectory
    .mockResolvedValueOnce({ id: 'idle' })
    .mockResolvedValueOnce({ id: 'running', job: { status: 'running' } });
  const project = { id: 'idle', revision: 1, generationConfig: { ttsVoice: 'Existing voice' } };
  repositoryMock.update.mockImplementation(async (_id, mutate) => {
    mutate(project);
    return project;
  });
  await getHandler('settings:set')(
    { senderFrame: { url: 'http://localhost:5173', parent: null } },
    { scriptTextModel: 'gpt-6-astra' }
  );
  expect(repositoryMock.update).toHaveBeenCalledTimes(1);
  expect(project.generationConfig).toMatchObject({
    scriptTextModel: 'gpt-6-astra',
    ttsVoice: 'Existing voice',
  });
});
