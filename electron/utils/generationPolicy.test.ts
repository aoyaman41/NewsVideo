import { afterEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROVIDER_CONCURRENCY,
  RateWindow,
  concurrencyFor,
  configureProviderConcurrency,
  limitedAnthropicFetch,
  limitedOpenAIFetch,
  limitedOpenAIImageFetch,
  pauseProviderSlot,
  resetProviderPauses,
  retryAfterMs,
  retryTransient,
  withProviderSlot,
} from './generationPolicy';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  configureProviderConcurrency();
  resetProviderPauses();
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

it('uses separate defaults for text, image and speech', () => {
  expect(DEFAULT_PROVIDER_CONCURRENCY).toEqual({ text: 4, image: 3, tts: 4 });
  expect(concurrencyFor('text')).toBe(4);
  expect(concurrencyFor('image')).toBe(3);
  expect(concurrencyFor('tts')).toBe(4);
});

it('does not retry authentication failures and malformed requests', async () => {
  for (const status of [400, 401, 403, 404]) {
    const operation = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('request rejected'), { status }));
    await expect(retryTransient(operation)).rejects.toThrow('request rejected');
    expect(operation).toHaveBeenCalledTimes(1);
  }
});

it('honors Retry-After and bounds transient retries', async () => {
  vi.useFakeTimers();
  const operation = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), {
        status: 429,
        headers: { get: (name: string) => (name === 'retry-after' ? '2' : null) },
      })
    )
    .mockResolvedValue('ok');
  const result = retryTransient(operation, 2, 1, 'gemini:tts');
  await vi.advanceTimersByTimeAsync(1999);
  expect(operation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe('ok');
});

it('caps concurrent operations across callers and releases a failed slot', async () => {
  configureProviderConcurrency({ tts: 1 });
  const gate = deferred();
  const order: string[] = [];
  const first = withProviderSlot('gemini:tts', async () => {
    order.push('first');
    await gate.promise;
    throw new Error('failed');
  }).catch(() => {});
  const second = withProviderSlot('gemini:tts', async () => {
    order.push('second');
  });
  expect(order).toEqual(['first']);
  gate.resolve();
  await Promise.all([first, second]);
  expect(order).toEqual(['first', 'second']);
});

it('keeps text and image requests of the same provider in separate slots', async () => {
  configureProviderConcurrency({ text: 1, image: 1 });
  const gate = deferred();
  const busyText = withProviderSlot('openai:text', () => gate.promise);
  // テキストの枠が埋まっていても、画像の枠は待たずに使える
  await withProviderSlot('openai:image', async () => {});
  let queued = false;
  const waitingText = withProviderSlot('openai:text', async () => {
    queued = true;
  });
  await Promise.resolve();
  expect(queued).toBe(false);
  gate.resolve();
  await Promise.all([busyText, waitingText]);
  expect(queued).toBe(true);
});

it('allows the configured number of Gemini speech requests at the same time', async () => {
  const gate = deferred();
  let running = 0;
  let peak = 0;
  const tasks = Array.from({ length: 6 }, () =>
    retryTransient(
      async () => {
        running++;
        peak = Math.max(peak, running);
        await gate.promise;
        running--;
      },
      1,
      1,
      'gemini:tts'
    )
  );
  await vi.waitFor(() => expect(running).toBe(4));
  gate.resolve();
  await Promise.all(tasks);
  expect(peak).toBe(4);
});

it('queues Anthropic SDK requests in their own provider slot', async () => {
  configureProviderConcurrency({ text: 1 });
  const response = deferred<Response>();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementationOnce(() => response.promise)
    .mockResolvedValueOnce(new Response('second'));

  const first = limitedAnthropicFetch('https://api.anthropic.com/v1/messages');
  const second = limitedAnthropicFetch('https://api.anthropic.com/v1/messages');
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await withProviderSlot('openai:text', async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(1);

  response.resolve(new Response('first'));
  await expect((await first).text()).resolves.toBe('first');
  await expect((await second).text()).resolves.toBe('second');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('limits OpenAI image requests per minute', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('{}'));
  configureProviderConcurrency({ image: 10 });
  const requests = Array.from({ length: 7 }, () =>
    limitedOpenAIImageFetch('https://api.openai.com/v1/images/generations', { method: 'POST' })
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(fetchMock).toHaveBeenCalledTimes(7);
  await Promise.all(requests);
});

it('does not count OpenAI text requests against the image rate', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('{}'));
  const requests = Array.from({ length: 8 }, () =>
    limitedOpenAIFetch('https://api.openai.com/v1/chat/completions', { method: 'POST' })
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(8);
  await Promise.all(requests);
});

it('pauses the same slot for Retry-After when OpenAI answers 429', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '20' } }))
    .mockImplementation(async () => new Response('{}'));
  const limited = await limitedOpenAIImageFetch('https://api.openai.com/v1/images/generations');
  expect(limited.status).toBe(429);
  const next = limitedOpenAIImageFetch('https://api.openai.com/v1/images/generations');
  await vi.advanceTimersByTimeAsync(19_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect((await next).status).toBe(200);
});

it('keeps waiting when a 429 pause begins while an image request waits for the per-minute window', async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('{}'));
  configureProviderConcurrency({ image: 10 });
  await Promise.all(
    Array.from({ length: 5 }, () =>
      limitedOpenAIImageFetch('https://api.openai.com/v1/images/generations')
    )
  );
  // 6 件目は 1 分の枠が空くまで待つ。その間に 429 で 90 秒の一時停止が入る
  const sixth = limitedOpenAIImageFetch('https://api.openai.com/v1/images/generations');
  await vi.advanceTimersByTimeAsync(10_000);
  pauseProviderSlot('openai:image', 90_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(40_000);
  expect(fetchMock).toHaveBeenCalledTimes(6);
  await sixth;
});

it('pauses a Gemini slot before handing it to the next waiting request', async () => {
  vi.useFakeTimers();
  configureProviderConcurrency({ tts: 1 });
  const rateLimited = Object.assign(new Error('rate limited'), {
    status: 429,
    headers: { get: (name: string) => (name === 'retry-after' ? '5' : null) },
  });
  const first = retryTransient(() => Promise.reject(rateLimited), 1, 1, 'gemini:tts').catch(
    (error) => error
  );
  let secondStarted = false;
  const second = retryTransient(
    async () => {
      secondStarted = true;
    },
    1,
    1,
    'gemini:tts'
  );
  expect(await first).toBe(rateLimited);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(secondStarted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await second;
  expect(secondStarted).toBe(true);
});

it('parses retry-after in milliseconds, seconds and HTTP dates', () => {
  const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
  expect(retryAfterMs(headers({ 'retry-after-ms': '1500' }))).toBe(1500);
  expect(retryAfterMs(headers({ 'retry-after': '3' }))).toBe(3000);
  const future = new Date(Date.now() + 10_000).toUTCString();
  expect(retryAfterMs(headers({ 'retry-after': future }))).toBeGreaterThan(8_000);
  expect(retryAfterMs(headers({}))).toBeUndefined();
  expect(retryAfterMs(undefined)).toBeUndefined();
});

it('waits for a paused slot before starting new work', async () => {
  vi.useFakeTimers();
  pauseProviderSlot('gemini:image', 5_000);
  let started = false;
  const task = withProviderSlot('gemini:image', async () => {
    started = true;
  });
  await vi.advanceTimersByTimeAsync(4_999);
  expect(started).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await task;
  expect(started).toBe(true);
});

it('spreads starts over a sliding window', async () => {
  vi.useFakeTimers();
  const window = new RateWindow(2, 1_000);
  const started: number[] = [];
  const tasks = Array.from({ length: 3 }, () =>
    window.acquire().then(() => started.push(Date.now()))
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(started).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1_000);
  await Promise.all(tasks);
  expect(started).toHaveLength(3);
});
