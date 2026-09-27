import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings/appSettings';
import { generationSettings } from '../utils/generationContext';
import { configureProviderConcurrency, limitedAnthropicFetch } from '../utils/generationPolicy';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  secrets: {} as Record<string, string>,
  construct: vi.fn(),
  create: vi.fn(),
  stream: vi.fn(),
  openaiParse: vi.fn(),
  openaiCreate: vi.fn(),
  geminiGenerate: vi.fn(),
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
vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  class MockOpenAI {
    chat = { completions: { parse: mocks.openaiParse, create: mocks.openaiCreate } };
  }
  return { ...actual, default: MockOpenAI };
});
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  class MockGoogleGenAI {
    models = { generateContent: mocks.geminiGenerate };
  }
  return { ...actual, GoogleGenAI: MockGoogleGenAI };
});

// 台本用と画像プロンプト用の effort を別の値にして、用途ごとに正しい方が送られることを確かめる
const CLAUDE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  scriptTextModel: 'claude-opus-5-5',
  imagePromptTextModel: 'claude-opus-5-5',
  claudeEffort: 'high',
  claudeImagePromptEffort: 'low',
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
  mocks.openaiParse.mockReset();
  mocks.openaiCreate.mockReset();
  mocks.geminiGenerate.mockReset();
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
    const settings = CLAUDE_SETTINGS;
    // テキスト(Anthropic)の枠を 1 にして、ストリーム全体が 1 つの枠を持ち続けることを確かめる
    configureProviderConcurrency({ text: 1 });
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
      configureProviderConcurrency();
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

describe('script prompt', () => {
  it('leaves the JSON format to the schema and tells the model the text is read aloud', async () => {
    streamReturning(claudeMessage(JSON.stringify(scriptPayload)));

    await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateScript')(undefined, article, { targetPartCount: 3 })
    );

    const request = lastRequest(mocks.stream) as {
      system: string;
      messages: Array<{ content: string }>;
      output_config: { format: { schema: unknown } };
    };
    const userPrompt = request.messages[0].content;
    expect(request.system).toContain('あなたは情報動画のスクリプトライターです');
    // 役割の宣言は system にだけ書き、JSON の例と「JSON のみ」の指示はスキーマに任せる
    expect(userPrompt).not.toContain('あなたは');
    expect(userPrompt).not.toContain('JSON');
    expect(userPrompt).toContain('3個のパートに分割');
    expect(userPrompt).toContain('音声合成でそのまま読み上げます');
    expect(userPrompt).toContain('括弧・記号・英字の略語は使わず');
    expect(JSON.stringify(request.output_config.format.schema)).toContain('ナレーション本文');
  });

  // M5: 秒数から文字数への換算は実測の 5.3 文字/秒(以前は 4 文字/秒で、動画が目標より短くなっていた)
  it('converts the target seconds per scene with the measured reading speed', async () => {
    streamReturning(claudeMessage(JSON.stringify(scriptPayload)));
    await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateScript')(undefined, article, { targetDurationPerPartSec: 30 })
    );
    const prompt = (lastRequest(mocks.stream) as { messages: Array<{ content: string }> })
      .messages[0].content;
    expect(prompt).toContain('各パートは約30秒（日本語で約159文字）');
    // シーン数の指定がないときは、既定の用途(ニュース)のシーン数
    expect(prompt).toContain('3個のパートに分割');
  });
});

const slideDesign = {
  visualCopy: {
    headline: '新しい橋が開通',
    subhead: '',
    keyNumber: '',
    bullets: ['通勤時間が短縮'],
  },
  layoutPlan: {
    intent: '開通を伝える',
    composition: '見出しを上部に配置',
    objects: [
      {
        type: 'headline',
        role: '主情報',
        position: 'top-center',
        content: '見出しを大きく配置',
        emphasis: 'large',
      },
    ],
  },
};
const parts = [
  { id: 'part-1', index: 0, title: '概要', summary: '開通', scriptText: '橋が開通しました。' },
  { id: 'part-2', index: 1, title: '影響', summary: '短縮', scriptText: '通勤が短縮します。' },
];

type ClaudeTextBlock = { type: 'text'; text: string; cache_control?: unknown };
type ClaudeRequest = {
  system: unknown;
  messages: Array<{ role: string; content: ClaudeTextBlock[] }>;
  output_config: { effort?: string; format?: { schema: Record<string, unknown> } };
};

function claudeRequests(): ClaudeRequest[] {
  return mocks.create.mock.calls.map(([request]) => request as ClaudeRequest);
}

function articleIdOf(text: string): string {
  const id = text.match(/^<article id="(article-[0-9a-f]{12})">/)?.[1];
  if (!id) throw new Error(`article tag not found: ${text.slice(0, 40)}`);
  return id;
}

describe('Claude image prompt generation', () => {
  it('caches the article block and uses structured output for batch requests', async () => {
    mocks.create.mockResolvedValue(
      claudeMessage(JSON.stringify(slideDesign), {
        usage: { input_tokens: 300, cache_read_input_tokens: 900, output_tokens: 400 },
      })
    );

    const result = (await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateImagePrompts')(undefined, parts, article, {})
    )) as {
      prompts: Array<{ prompt: string; visualCopy?: unknown; negativePrompt: string }>;
      usage: Record<string, unknown>;
    };

    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const requests = claudeRequests();
    for (const request of requests) {
      expect(request).toMatchObject({
        model: 'claude-opus-5-5',
        max_tokens: 16_000,
        // 画像プロンプトは台本(high)とは別の claudeImagePromptEffort を使う
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: expect.objectContaining({ type: 'object' }) },
        },
      });
      for (const key of ['thinking', 'temperature', 'top_p', 'top_k']) {
        expect(request).not.toHaveProperty(key);
      }
      expect(typeof request.system).toBe('string');
      expect(request.system).not.toContain('JSON');
      const [articleBlock, partBlock] = request.messages[0].content;
      expect(request.messages[0].content).toHaveLength(2);
      expect(articleBlock).toEqual({
        type: 'text',
        text: expect.stringMatching(/^<article id="article-[0-9a-f]{12}">\n/),
        cache_control: { type: 'ephemeral' },
      });
      expect(articleBlock.text).toContain(article.bodyText);
      expect(articleBlock.text.endsWith('</article>')).toBe(true);
      expect(partBlock).not.toHaveProperty('cache_control');
      expect(partBlock.text).toContain(articleIdOf(articleBlock.text));
    }
    // 記事ブロックはパート間で完全に同じ(キャッシュの前提)で、パートの情報は 2 番目のブロックに入る
    expect(requests[0].messages[0].content[0]).toEqual(requests[1].messages[0].content[0]);
    expect(requests[0].messages[0].content[1].text).toContain('パート番号: 1');
    expect(requests[1].messages[0].content[1].text).toContain('パート番号: 2');

    // 画像プロンプトの組み立てで使わない項目は出力させない
    const schema = requests[0].output_config.format!.schema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual(['visualCopy', 'layoutPlan']);
    expect(JSON.stringify(schema)).toContain('新しい文字列は入れない');

    const prompt = result.prompts[0].prompt;
    expect(prompt).toContain(
      '画面に描く文字:\n- 見出し:「新しい橋が開通」\n- 要点1:「通勤時間が短縮」'
    );
    expect(prompt).not.toContain('サブ見出し');
    expect(prompt).not.toContain('画面コピー');
    expect(prompt).not.toContain('描画しない');
    expect(result.prompts[0].visualCopy).toEqual({
      headline: '新しい橋が開通',
      bullets: ['通勤時間が短縮'],
    });
    expect(result.prompts[0].negativePrompt).toBe('人物, 顔, 手, ロゴ, 透かし, QRコード');
    expect(result.usage).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      inputTokens: 2400,
      cachedInputTokens: 1800,
      requestCount: 2,
    });
  });

  it('adds the cache breakpoint even when the batch has only one part', async () => {
    mocks.create.mockResolvedValue(claudeMessage(JSON.stringify(slideDesign)));

    await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateImagePrompts')(undefined, parts.slice(0, 1), article, {})
    );

    expect(claudeRequests()[0].messages[0].content[0]).toMatchObject({
      cache_control: { type: 'ephemeral' },
    });
  });

  it('caches the same article block on the single-target path used by automatic jobs', async () => {
    mocks.create.mockResolvedValue(claudeMessage(JSON.stringify(slideDesign)));

    await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateImagePrompts')(undefined, parts.slice(0, 1), article, {})
    );
    const result = (await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:generateImagePromptForTarget')(undefined, parts, article, 'part-2', {})
    )) as { prompt: { partId: string; prompt: string } };

    const [batchRequest, targetRequest] = claudeRequests();
    expect(targetRequest.messages[0].content[0]).toEqual(batchRequest.messages[0].content[0]);
    expect(targetRequest.messages[0].content[1].text).toContain('パート番号: 2');
    expect(targetRequest.output_config).toMatchObject({ effort: 'low' });
    expect(result.prompt.partId).toBe('part-2');
    expect(result.prompt.prompt).toContain('- 見出し:「新しい橋が開通」');
  });

  it('keeps the article id stable for the same article and changes it with the article', async () => {
    mocks.create.mockResolvedValue(claudeMessage(JSON.stringify(slideDesign)));
    const editedArticle = { ...article, bodyText: `${article.bodyText}追記。` };

    for (const target of [article, article, editedArticle]) {
      await runWithSettings(CLAUDE_SETTINGS, () =>
        handler('ai:generateImagePromptForTarget')(undefined, parts, target, 'part-1', {})
      );
    }

    const ids = claudeRequests().map((request) => articleIdOf(request.messages[0].content[0].text));
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('rejects a response that does not match the slide design schema', async () => {
    mocks.create.mockResolvedValueOnce(
      claudeMessage(`\`\`\`json\n${JSON.stringify(slideDesign)}\n\`\`\``)
    );

    await expect(
      runWithSettings(CLAUDE_SETTINGS, () =>
        handler('ai:generateImagePromptForTarget')(undefined, parts, article, 'part-1', {})
      )
    ).rejects.toThrow('AIから構造化された応答を取得できませんでした');
  });
});

describe('Claude comment application', () => {
  it('returns plain text for script comments with the script effort', async () => {
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

  it('uses structured output and the image prompt effort for image prompt comments', async () => {
    mocks.create.mockResolvedValueOnce(claudeMessage(JSON.stringify({ prompt: '修正後の指示' })));

    const result = (await runWithSettings(CLAUDE_SETTINGS, () =>
      handler('ai:applyComment')(
        undefined,
        { type: 'imagePrompt', id: 'prompt-1', currentText: '元の指示' },
        '色を明るく'
      )
    )) as { text: string };

    expect(result.text).toBe('修正後の指示');
    const request = lastRequest(mocks.create) as {
      system: string;
      messages: Array<{ content: string }>;
      output_config: unknown;
    };
    expect(request.output_config).toMatchObject({
      effort: 'low',
      format: { type: 'json_schema', schema: expect.objectContaining({ type: 'object' }) },
    });
    expect(request.system).not.toContain('JSON');
    expect(request.messages[0].content).not.toContain('JSON');
    expect(request.messages[0].content).toContain('「画面に描く文字」欄');
  });
});

const OPENAI_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  scriptTextModel: 'gpt-5.6-sol',
  imagePromptTextModel: 'gpt-5.6-sol',
  openaiReasoningEffort: 'medium',
};

function openaiParsed(parsed: unknown, model = 'gpt-5.6-sol') {
  return {
    model,
    choices: [{ finish_reason: 'stop', message: { parsed, refusal: null } }],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 300,
      total_tokens: 1500,
      prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
    },
  };
}

type OpenAIRequest = {
  messages: Array<{ role: string; content: unknown }>;
  prompt_cache_key?: string;
  response_format: unknown;
  reasoning_effort?: string;
  temperature?: number;
};

describe('OpenAI image prompt generation', () => {
  beforeEach(() => {
    mocks.secrets = { openai: 'test-openai-key' };
  });

  it('sends the article as its own content part with a cache breakpoint on gpt-5.6', async () => {
    mocks.openaiParse.mockResolvedValue(openaiParsed(slideDesign));

    const result = (await runWithSettings(OPENAI_SETTINGS, () =>
      handler('ai:generateImagePromptForTarget')(undefined, parts, article, 'part-1', {})
    )) as { prompt: { prompt: string }; usage: Record<string, unknown> };

    const request = mocks.openaiParse.mock.calls[0][0] as OpenAIRequest;
    expect(request.messages[0]).toEqual({ role: 'system', content: expect.any(String) });
    const [articlePart, partPart] = request.messages[1].content as Array<{
      type: string;
      text: string;
      prompt_cache_breakpoint?: unknown;
    }>;
    expect(articlePart).toEqual({
      type: 'text',
      text: expect.stringMatching(/^<article id="article-[0-9a-f]{12}">/),
      prompt_cache_breakpoint: { mode: 'explicit' },
    });
    expect(partPart).toEqual({ type: 'text', text: expect.stringContaining('パート番号: 1') });
    expect(request.prompt_cache_key).toBe(articleIdOf(articlePart.text));
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'slide_design', strict: true },
    });
    expect(request.reasoning_effort).toBe('medium');
    expect(request).not.toHaveProperty('temperature');
    expect(result.prompt.prompt).toContain('- 見出し:「新しい橋が開通」');
    expect(result.usage).toMatchObject({
      provider: 'openai',
      inputTokens: 1200,
      cachedInputTokens: 800,
      cacheWriteTokens: 100,
    });
  });

  it('does not send a cache breakpoint to models older than gpt-5.6', async () => {
    mocks.openaiParse.mockResolvedValue(openaiParsed(slideDesign, 'gpt-5.2'));

    await runWithSettings(
      {
        ...OPENAI_SETTINGS,
        scriptTextModel: 'gpt-5.2',
        imagePromptTextModel: 'gpt-5.2',
        openaiReasoningEffort: 'none',
      },
      () => handler('ai:generateImagePromptForTarget')(undefined, parts, article, 'part-1', {})
    );

    const request = mocks.openaiParse.mock.calls[0][0] as OpenAIRequest;
    const [articlePart] = request.messages[1].content as Array<Record<string, unknown>>;
    expect(articlePart).not.toHaveProperty('prompt_cache_breakpoint');
    expect(request.prompt_cache_key).toMatch(/^article-[0-9a-f]{12}$/);
  });
});

const GEMINI_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  scriptTextModel: 'gemini-3.1-pro',
  imagePromptTextModel: 'gemini-3.1-pro',
  geminiThinkingLevel: 'high',
};

function geminiResponse(text: string) {
  return {
    text,
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      thoughtsTokenCount: 300,
      totalTokenCount: 1500,
    },
  };
}

type GeminiRequest = {
  model: string;
  contents: string;
  config: Record<string, unknown> & { responseJsonSchema?: unknown };
};

function geminiRequest(): GeminiRequest {
  const call = mocks.geminiGenerate.mock.calls.at(-1);
  if (!call) throw new Error('request was not sent');
  return call[0] as GeminiRequest;
}

describe('Gemini text generation', () => {
  beforeEach(() => {
    mocks.secrets = { google_ai: 'test-google-key' };
  });

  it('sends a JSON schema without temperature and counts thinking tokens as output', async () => {
    mocks.geminiGenerate.mockResolvedValue(geminiResponse(JSON.stringify(scriptPayload)));

    const result = (await runWithSettings(GEMINI_SETTINGS, () =>
      handler('ai:generateScript')(undefined, article, {})
    )) as { parts: Array<{ title: string }>; usage: Record<string, unknown> };

    const request = geminiRequest();
    expect(request.model).toBe('gemini-3.1-pro-preview');
    expect(request.config).not.toHaveProperty('temperature');
    expect(request.config.responseMimeType).toBe('application/json');
    const schemaText = JSON.stringify(request.config.responseJsonSchema);
    expect(schemaText).toContain('"parts"');
    expect(schemaText).toContain('ナレーション本文');
    for (const unsupported of ['$schema', 'minLength', 'exclusiveMinimum']) {
      expect(schemaText).not.toContain(unsupported);
    }
    expect(request.contents).not.toContain('JSON');
    expect(result.parts[0]).toMatchObject({ title: '開通の概要' });
    expect(result.usage).toMatchObject({
      provider: 'gemini',
      inputTokens: 1000,
      outputTokens: 500,
      reasoningTokens: 300,
      totalTokens: 1500,
    });
  });

  it('rejects a script response that does not match the schema', async () => {
    mocks.geminiGenerate.mockResolvedValue(geminiResponse(JSON.stringify({ parts: [] })));

    await expect(
      runWithSettings(GEMINI_SETTINGS, () => handler('ai:generateScript')(undefined, article, {}))
    ).rejects.toThrow('AIから構造化された応答を取得できませんでした');
  });

  it('extracts the slide design with a schema and the article at the start', async () => {
    mocks.geminiGenerate.mockResolvedValue(geminiResponse(JSON.stringify(slideDesign)));

    const result = (await runWithSettings(GEMINI_SETTINGS, () =>
      handler('ai:generateImagePromptForTarget')(undefined, parts, article, 'part-2', {})
    )) as { prompt: { prompt: string } };

    const request = geminiRequest();
    expect(request.contents).toMatch(/^<article id="article-[0-9a-f]{12}">/);
    expect(request.contents).toContain('パート番号: 2');
    expect(request.config).not.toHaveProperty('temperature');
    expect(request.config.responseJsonSchema).toMatchObject({
      type: 'object',
      properties: { visualCopy: expect.any(Object), layoutPlan: expect.any(Object) },
    });
    expect(result.prompt.prompt).toContain('- 見出し:「新しい橋が開通」');
  });

  it('uses a schema only for image prompt comments', async () => {
    mocks.geminiGenerate.mockResolvedValueOnce(geminiResponse('修正後のスクリプト'));
    await runWithSettings(GEMINI_SETTINGS, () =>
      handler('ai:applyComment')(
        undefined,
        { type: 'script', id: 'part-1', currentText: '元のスクリプト' },
        '短く'
      )
    );
    expect(geminiRequest().config).not.toHaveProperty('responseJsonSchema');
    expect(geminiRequest().config).not.toHaveProperty('responseMimeType');
    expect(geminiRequest().config).not.toHaveProperty('temperature');

    mocks.geminiGenerate.mockResolvedValueOnce(
      geminiResponse(JSON.stringify({ prompt: '修正後の指示' }))
    );
    const result = (await runWithSettings(GEMINI_SETTINGS, () =>
      handler('ai:applyComment')(
        undefined,
        { type: 'imagePrompt', id: 'prompt-1', currentText: '元の指示' },
        '色を明るく'
      )
    )) as { text: string };
    expect(geminiRequest().config).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', properties: { prompt: expect.any(Object) } },
    });
    expect(result.text).toBe('修正後の指示');
  });
});
