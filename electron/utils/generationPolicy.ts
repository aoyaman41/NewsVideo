import { generationSettings } from './generationContext';
import { classifyGenerationError } from '../../shared/project/jobs';

let defaultConcurrency = 2;
const active = new Map<string, number>();
const waiters = new Map<string, Array<() => void>>();

export function configureGenerationConcurrency(value: number) {
  defaultConcurrency = Math.max(1, Math.min(4, Math.round(value)));
}

export async function withProviderSlot<T>(
  provider: string,
  operation: () => Promise<T>
): Promise<T> {
  const limit = generationSettings.getStore()?.generationConcurrency ?? defaultConcurrency;
  while ((active.get(provider) ?? 0) >= limit)
    await new Promise<void>((resolve) => {
      const queue = waiters.get(provider) ?? [];
      queue.push(resolve);
      waiters.set(provider, queue);
    });
  active.set(provider, (active.get(provider) ?? 0) + 1);
  try {
    return await operation();
  } finally {
    active.set(provider, (active.get(provider) ?? 1) - 1);
    waiters.get(provider)?.shift()?.();
  }
}

export const limitedOpenAIFetch: typeof fetch = (input, init) =>
  withProviderSlot('openai', () => {
    init?.signal?.throwIfAborted();
    return fetch(input, init);
  });

export async function retryTransient<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withProviderSlot('gemini', operation);
    } catch (error) {
      const classified = classifyGenerationError(error);
      if (!['rate_limit', 'transient'].includes(classified.kind) || attempt + 1 >= maxAttempts)
        throw error;
      const headers = (error as { headers?: { get?: (name: string) => string | null } })?.headers;
      const retryAfter = headers?.get?.('retry-after');
      const seconds = Number(retryAfter);
      const serverDelay = retryAfter
        ? Number.isFinite(seconds)
          ? seconds * 1000
          : Math.max(0, Date.parse(retryAfter) - Date.now())
        : 0;
      const delay = Math.max(
        serverDelay || 0,
        Math.min(30_000, baseDelay * 2 ** attempt + Math.random() * baseDelay)
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
