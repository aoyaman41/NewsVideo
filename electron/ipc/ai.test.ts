import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings/appSettings';
import { generationSettings } from '../utils/generationContext';
import { limitedAnthropicFetch } from '../utils/generationPolicy';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  secrets: {} as Record<string, string>,
  construct: vi.fn(),
  create: vi.fn(),
  stream: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/newsvideo-ai-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: () => JSON.stringify(mocks.secrets),
  },
}));
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from('encrypted')),
}));
vi.mock('./operations', () => ({
  registerOperation: (name: string, handler: Handler) => mocks.handlers.set(name, handler),
}));
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class MockAnthropic {
    static APIError = actual.APIError;
    messages = { create: mocks.create, stream: mocks.stream };
    constructor(options: unknown) {
      mocks.construct(options);
    }
  }
  return { ...actual, default: MockAnthropic };
});

const CLAUDE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  scriptTextModel: 'claude-opus-5-5',
  imagePromptTextModel: 'claude-opus-5-5',
  claudeEffort: 'high',
};

const article = {
  title: '新しい橋が開通',
  source: '市の発表',
  bodyText: '市内で新しい橋が開通し、通勤時間が短縮される見込みです。',
  importedImages: [],
};

const scriptPayload = {
  parts: [
    {
      title: '開通の概要',
      summary: '新しい橋が開通した。',
      scriptText: '市内で新しい橋が開通しました。',
      durationEstimateSec: 30,
    },
  ],
};

function claudeMessage(
  text: string,
  overrides: Partial<Omit<Anthropic.Messages.Message, 'usage'>> & {
    usage?: Partial<Anthropic.Messages.Usage>;
  } = {}
): Anthropic.Messages.Message {
  const { usage, ...rest } = overrides;
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    container: null,
    content: [
      { type: 'thinking', thinking: '', signature: 'signature' },
      { type: 'text', text, citations: null },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    ...rest,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      inference_geo: null,
      input_tokens: 1000,
      output_tokens: 500,
      output_tokens_details: { thinking_tokens: 200 },
      server_tool_use: null,
      service_tier: 'standard',
      ...usage,
    },
  } as Anthropic.Messages.Message;
}

function streamReturning(message: Anthropic.Messages.Message) {
  mocks.stream.mockReturnValueOnce({ finalMessage: async () => message });
}

function handler(name: string): Handler {
  const registered = mocks.handlers.get(name);
  if (!registered) throw new Error(`Handler not found: ${name}`);
  return registered;
}

function runWithSettings<T>(settings: AppSettings, operation: () => Promise<T>): Promise<T> {
  return generationSettings.run(settings, operation);
}

function lastRequest(mock: typeof mocks.create): Record<string, unknown> {
  const call = mock.mock.calls.at(-1);
  if (!call) throw new Error('request was not sent');
  return call[0] as Record<string, unknown>;
}

beforeAll(async () => {
  await import('./ai');
});

beforeEach(() => {
  mocks.secrets = { anthropic: 'test-anthropic-key' };
  mocks.construct.mockReset();
  mocks.create.mockReset();
  mocks.stream.mockReset();
});

describe('Claude script generation', () => {
  it('streams a structured request without thinking, sampling or prefill parameters', async () => {
    streamReturning(claudeMessage(JSON.stringify(scriptPayload)));

    const result = (await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateScript')(undefined, article, { targetPartCount: 1 })
    )) as { parts: Array<{ title: string; scriptText: string }> };

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    // ストリーミングは fetch 単位ではなくストリーム全体で同時実行枠を取るため、通常の fetch を使う
    expect(mocks.construct).toHaveBeenCalledWith({
      apiKey: 'test-anthropic-key',
      authToken: null,
    });

    const request = lastRequest(mocks.stream);
    expect(request).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64_000,
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: expect.objectContaining({ type: 'object' }) },
      },
    });
    for (const key of ['thinking', 'temperature', 'top_p', 'top_k', 'fallbacks', 'effort']) {
      expect(request).not.toHaveProperty(key);
    }
    expect(request.messages).toEqual([{ role: 'user', content: expect.any(String) }]);
    expect(typeof request.system).toBe('string');
    // 構造化出力のスキーマだけを送り、パースは stop_reason の確認後に行う
    expect(request.output_config).not.toHaveProperty('format.parse');

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ title: '開通の概要' });
  });

  it('holds one anthropic slot until the whole stream finishes', async () => {
    let finish!: (message: Anthropic.Messages.Message) => void;
    mocks.stream.mockReturnValueOnce({
      finalMessage: () =>
        new Promise<Anthropic.Messages.Message>((resolve) => {
          finish = resolve;
        }),
    });
    const fetchStub = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchStub);
    const settings = { ...CLAUDE_SETTINGS, generationConcurrency: 1 };
    try {
      const generation = runWithSettings(settings, () =>
        handler('ai:generateScript')(undefined, article, {})
      );
      await vi.waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1));
      const otherRequest = runWithSettings(settings, () =>
        limitedAnthropicFetch('https://api.anthropic.com/v1/messages')
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetchStub).not.toHaveBeenCalled();

      finish(claudeMessage(JSON.stringify(scriptPayload)));
      await generation;
      await otherRequest;
      expect(fetchStub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['low', 'medium', 'xhigh', 'max'] as const)(
    'sends the %s effort inside output_config',
    async (claudeEffort) => {
      streamReturning(claudeMessage(JSON.stringify(scriptPayload)));

      await runWithSettings({ ...CLAUDE_SETTINGS, claudeEffort }, () =>
        handler('ai:generateScript')(undefined, article, {})
      );

      expect(lastRequest(mocks.stream).output_config).toMatchObject({ effort: claudeEffort });
    }
  );

  it('maps usage with cache reads and writes included in the input total', async () => {
    streamReturning(
      claudeMessage(JSON.stringify(scriptPayload), {
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 500,
          output_tokens: 700,
          output_tokens_details: { thinking_tokens: 300 },
        },
      })
    );

    const result = (await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateScript')(undefined, article, {})
    )) as { usage: unknown };

    expect(result.usage).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      inputTokens: 3500,
      cachedInputTokens: 2000,
      cacheWriteTokens: 500,
      outputTokens: 700,
      reasoningTokens: 300,
      totalTokens: 4200,
      requestCount: 1,
    });
  });

  it('reports a refusal as an error without falling back to another model', async () => {
    streamReturning(
      claudeMessage('', {
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: 'refused' },
      })
    );

    await expect(
      runWithSettings(CLAUDE_SETTINGS, () => handler('ai:generateScript')(undefined, article, {}))
    ).rejects.toThrow(
      'Claudeが安全上の理由で生成を拒否しました(カテゴリ: cyber)。記事内容を確認するか、別のモデルで再実行してください。'
    );
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects output truncated by max_tokens instead of using partial JSON', async () => {
    streamReturning(claudeMessage('{"parts":[{"title":"開通', { stop_reason: 'max_tokens' }));

    await expect(
      runWithSettings(CLAUDE_SETTINGS, () => handler('ai:generateScript')(undefined, article, {}))
    ).rejects.toThrow('Claudeの出力が上限で途中終了しました');
  });

  it('rejects structured output that does not match the script schema', async () => {
    streamReturning(claudeMessage(JSON.stringify({ parts: [] })));

    await expect(
      runWithSettings(CLAUDE_SETTINGS, () => handler('ai:generateScript')(undefined, article, {}))
    ).rejects.toThrow('AIから構造化された応答を取得できませんでした');
  });

  it('requires an Anthropic API key before calling the API', async () => {
    mocks.secrets = { openai: 'test-openai-key' };

    await expect(
      runWithSettings(CLAUDE_SETTINGS, () => handler('ai:generateScript')(undefined, article, {}))
    ).rejects.toThrow(
      'Anthropic APIキーが設定されていません。設定画面からAPIキーを入力してください。'
    );
    expect(mocks.construct).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});

describe('Claude image prompt generation', () => {
  const imagePromptJson = JSON.stringify({
    prompts: [
      {
        topic: '新しい橋',
        entities: ['橋'],
        locations: [],
        quantFacts: [],
        visualCopy: { headline: '新しい橋が開通', bullets: ['通勤時間が短縮'] },
        layoutPlan: {
          intent: '開通を伝える',
          composition: '見出しを上部に配置',
          objects: [
            {
              type: 'headline',
              role: '主情報',
              position: 'top-center',
              content: '新しい橋が開通',
              emphasis: 'large',
            },
          ],
        },
      },
    ],
  });
  const parts = [
    { id: 'part-1', index: 0, title: '概要', summary: '開通', scriptText: '橋が開通しました。' },
    { id: 'part-2', index: 1, title: '影響', summary: '短縮', scriptText: '通勤が短縮します。' },
  ];

  it('caches the repeated system prompt for per-scene batch requests', async () => {
    mocks.create.mockResolvedValue(
      claudeMessage(`\`\`\`json\n${imagePromptJson}\n\`\`\``, {
        usage: { input_tokens: 300, cache_read_input_tokens: 900, output_tokens: 400 },
      })
    );

    const result = (await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateImagePrompts')(undefined, parts, article, {})
    )) as { prompts: Array<{ prompt: string }>; usage: Record<string, unknown> };

    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.create.mock.calls) {
      expect(request).toMatchObject({
        model: 'claude-opus-5-5',
        max_tokens: 16_000,
        system: [{ type: 'text', text: expect.any(String), cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'high' },
      });
      expect(request.output_config).not.toHaveProperty('format');
      for (const key of ['thinking', 'temperature', 'top_p', 'top_k']) {
        expect(request).not.toHaveProperty(key);
      }
    }
    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[0].prompt).toContain('新しい橋が開通');
    expect(result.usage).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      inputTokens: 2400,
      cachedInputTokens: 1800,
      requestCount: 2,
    });
  });

  it('does not add a cache breakpoint for a single-scene regeneration', async () => {
    mocks.create.mockResolvedValueOnce(claudeMessage(imagePromptJson));

    await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateImagePromptForTarget')(undefined, parts, article, 'part-2', {})
    );

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(typeof lastRequest(mocks.create).system).toBe('string');
  });
});

describe('Claude comment application', () => {
  it('returns plain text for script comments', async () => {
    mocks.create.mockResolvedValueOnce(claudeMessage('修正後のスクリプトです。'));

    const result = (await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:applyComment')(
        undefined,
        { type: 'script', id: 'part-1', currentText: '元のスクリプト' },
        'もっと短く'
      )
    )) as { text: string; usage: { provider: string } };

    expect(result.text).toBe('修正後のスクリプトです。');
    expect(result.usage.provider).toBe('anthropic');
    const request = lastRequest(mocks.create);
    expect(request).toMatchObject({ max_tokens: 16_000, output_config: { effort: 'high' } });
    expect(request.output_config).not.toHaveProperty('format');
  });

  it('uses structured output for image prompt comments', async () => {
    mocks.create.mockResolvedValueOnce(claudeMessage(JSON.stringify({ prompt: '修正後の指示' })));

    const result = (await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:applyComment')(
        undefined,
        { type: 'imagePrompt', id: 'prompt-1', currentText: '元の指示' },
        '色を明るく'
      )
    )) as { text: string };

    expect(result.text).toBe('修正後の指示');
    expect(lastRequest(mocks.create).output_config).toMatchObject({
      effort: 'high',
      format: { type: 'json_schema', schema: expect.objectContaining({ type: 'object' }) },
    });
  });
});
