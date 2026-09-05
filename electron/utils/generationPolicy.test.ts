import { afterEach, expect, it, vi } from 'vitest';
import {
  retryTransient,
  withProviderSlot,
  configureGenerationConcurrency,
} from './generationPolicy';

afterEach(() => {
  vi.useRealTimers();
  configureGenerationConcurrency(2);
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
      Object.assign(new Error('rate limited'), { status: 429, headers: { get: () => '2' } })
    )
    .mockResolvedValue('ok');
  const result = retryTransient(operation, 2, 1);
  await vi.advanceTimersByTimeAsync(1999);
  expect(operation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe('ok');
});

it('caps concurrent operations across callers and releases a failed slot', async () => {
  configureGenerationConcurrency(1);
  let release!: () => void;
  const order: string[] = [];
  const first = withProviderSlot('test', async () => {
    order.push('first');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new Error('failed');
  }).catch(() => {});
  const second = withProviderSlot('test', async () => {
    order.push('second');
  });
  expect(order).toEqual(['first']);
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(['first', 'second']);
});
