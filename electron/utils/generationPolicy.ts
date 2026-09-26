import { classifyGenerationError } from '../../shared/project/jobs';

export type GenerationProvider = 'openai' | 'anthropic' | 'gemini';
export type GenerationKind = 'text' | 'image' | 'tts';
/** 同時実行数の枠。プロバイダと用途の組ごとに別の枠を持つ(例: OpenAI のテキストと画像は別の枠) */
export type ProviderSlot = `${GenerationProvider}:${GenerationKind}`;

/**
 * 用途ごとの同時実行数の既定値。枠はプロセス全体(自動生成ジョブ・画面からの生成・複数のプロジェクト)で共有する。
 * 以前の設定 generationConcurrency(全プロバイダ共通の 1 つの値)は使わない。
 */
export const DEFAULT_PROVIDER_CONCURRENCY: Readonly<Record<GenerationKind, number>> = {
  text: 4,
  image: 3,
  tts: 4,
};
/** OpenAI の画像生成の 1 分あたりの枚数の上限(Tier 1 は 5 枚/分) */
export const OPENAI_IMAGES_PER_MINUTE = 5;
/** retry-after が極端に長い場合でも、ほかの処理を待たせすぎないための上限 */
const MAX_PAUSE_MS = 120_000;

let limits: Record<GenerationKind, number> = { ...DEFAULT_PROVIDER_CONCURRENCY };

/** テスト用: 同時実行数を変える(省略した用途は既定値に戻す) */
export function configureProviderConcurrency(next: Partial<Record<GenerationKind, number>> = {}) {
  limits = { ...DEFAULT_PROVIDER_CONCURRENCY, ...next };
  for (const [slot, state] of slots) wake(slot, state);
}

/** テスト用: 一時停止と 1 分あたりの記録を消す(実行中の枠は変えない) */
export function resetProviderPauses() {
  for (const state of slots.values()) state.pausedUntil = 0;
  openAIImageRate.reset();
}

export function concurrencyFor(kind: GenerationKind): number {
  return Math.max(1, Math.round(limits[kind]));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

type SlotState = { active: number; waiters: Array<() => void>; pausedUntil: number };
const slots = new Map<ProviderSlot, SlotState>();

function slotState(slot: ProviderSlot): SlotState {
  let state = slots.get(slot);
  if (!state) {
    state = { active: 0, waiters: [], pausedUntil: 0 };
    slots.set(slot, state);
  }
  return state;
}

function kindOf(slot: ProviderSlot): GenerationKind {
  return slot.split(':')[1] as GenerationKind;
}

function wake(slot: ProviderSlot, state: SlotState) {
  while (state.waiters.length > 0 && state.active < concurrencyFor(kindOf(slot))) {
    state.active++;
    state.waiters.shift()!();
  }
}

/**
 * 枠が空くまで待ってから operation を実行する。レート制限(429)で枠が一時停止しているときは、
 * 停止が明けるまで待ってから始める(同じ枠のほかのリクエストも同じだけ待つ)。
 */
export async function withProviderSlot<T>(
  slot: ProviderSlot,
  operation: () => Promise<T>
): Promise<T> {
  const state = slotState(slot);
  if (state.active < concurrencyFor(kindOf(slot)) && state.waiters.length === 0) state.active++;
  else await new Promise<void>((resolve) => state.waiters.push(resolve));
  try {
    while (state.pausedUntil > Date.now()) await sleep(state.pausedUntil - Date.now());
    return await operation();
  } finally {
    state.active--;
    wake(slot, state);
  }
}

/** 429 の retry-after の間、同じ枠の新しいリクエストを止める */
export function pauseProviderSlot(slot: ProviderSlot, ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const state = slotState(slot);
  state.pausedUntil = Math.max(state.pausedUntil, Date.now() + Math.min(ms, MAX_PAUSE_MS));
}

type HeaderSource = { get?: (name: string) => string | null | undefined } | undefined | null;

/** retry-after-ms / retry-after(秒または日時)をミリ秒にする。なければ undefined */
export function retryAfterMs(headers: HeaderSource): number | undefined {
  const millis = Number(headers?.get?.('retry-after-ms'));
  if (headers?.get?.('retry-after-ms') && Number.isFinite(millis)) return Math.max(0, millis);
  const value = headers?.get?.('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** 一定時間あたりの開始回数を制限する(スライディングウィンドウ) */
export class RateWindow {
  private starts: number[] = [];
  constructor(
    private perWindow: number,
    private windowMs = 60_000
  ) {}

  /** pausedFor は、ほかに待つべき時間(429 の一時停止の残り)を返す。その間は開始を記録しない */
  async acquire(pausedFor: () => number = () => 0) {
    for (;;) {
      const paused = pausedFor();
      if (paused > 0) {
        await sleep(paused);
        continue;
      }
      const now = Date.now();
      this.starts = this.starts.filter((time) => now - time < this.windowMs);
      if (this.starts.length < this.perWindow) {
        this.starts.push(now);
        return;
      }
      await sleep(this.starts[0] + this.windowMs - now);
    }
  }

  reset() {
    this.starts = [];
  }
}

export const openAIImageRate = new RateWindow(OPENAI_IMAGES_PER_MINUTE);

function pausedFor(slot: ProviderSlot) {
  return () => Math.max(0, slotState(slot).pausedUntil - Date.now());
}

function limitedFetch(
  slot: ProviderSlot,
  before?: (pausedFor: () => number) => Promise<void>
): typeof fetch {
  return (input, init) =>
    withProviderSlot(slot, async () => {
      init?.signal?.throwIfAborted();
      // 1 分あたりの枠を待つ間に 429 の一時停止が入った場合も、明けるまで送らない
      await before?.(pausedFor(slot));
      init?.signal?.throwIfAborted();
      const response = await fetch(input, init);
      // SDK は retry-after に従って再試行する。その間に同じ枠のほかのリクエストが 429 を重ねないよう、枠ごと止める
      if (response.status === 429) pauseProviderSlot(slot, retryAfterMs(response.headers) ?? 0);
      return response;
    });
}

/** OpenAI のテキスト生成(SDK 内蔵リトライの各試行を含む)を同時実行数の制御に乗せる */
export const limitedOpenAIFetch: typeof fetch = limitedFetch('openai:text');

/** OpenAI の画像生成。同時実行数に加え、1 分あたりの枚数も制御する */
export const limitedOpenAIImageFetch: typeof fetch = limitedFetch('openai:image', (paused) =>
  openAIImageRate.acquire(paused)
);

// Anthropic SDK の各試行(SDK 内蔵リトライを含む)を同時実行数の制御に乗せる
export const limitedAnthropicFetch: typeof fetch = limitedFetch('anthropic:text');

/**
 * Gemini などの SDK 内蔵リトライを持たない呼び出しを、枠の制御と一時的な失敗の再試行で包む。
 * slot は用途ごとに指定する(テキスト・画像・音声で別の枠)。
 */
export async function retryTransient<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000,
  slot: ProviderSlot = 'gemini:text'
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withProviderSlot(slot, async () => {
        try {
          return await operation();
        } catch (error) {
          // 枠を返す前に一時停止を入れ、待っているほかのリクエストが 429 を重ねないようにする(最後の試行でも)
          if (classifyGenerationError(error).kind === 'rate_limit')
            pauseProviderSlot(
              slot,
              retryAfterMs((error as { headers?: HeaderSource })?.headers) ?? 0
            );
          throw error;
        }
      });
    } catch (error) {
      const classified = classifyGenerationError(error);
      if (!['rate_limit', 'transient'].includes(classified.kind) || attempt + 1 >= maxAttempts)
        throw error;
      const headers = (error as { headers?: HeaderSource })?.headers;
      const serverDelay = retryAfterMs(headers) ?? 0;
      const delay = Math.max(
        serverDelay,
        Math.min(30_000, baseDelay * 2 ** attempt + Math.random() * baseDelay)
      );
      await sleep(delay);
    }
  }
}
