/** 書き出しのプロセスが進捗を出さないまま、この時間が過ぎたら止める */
export const DEFAULT_STALL_TIMEOUT_MS = 90_000;

/**
 * 止まったときのエラー文。自動生成ジョブでは「一時的な失敗」(再試行できる)に分類されるよう timeout を含める
 */
export function stallErrorMessage(timeoutMs: number, step: string) {
  const seconds = Math.round(timeoutMs / 1000);
  return `動画の書き出しが${seconds}秒以上進まなかったため中断しました(${step}、timeout)。ほかのアプリを閉じるか、解像度を下げてから、もう一度書き出してください。`;
}

/** 進捗のたびに reset を呼ぶ。timeoutMs の間 reset がなければ onStall を 1 回呼ぶ */
export function createStallWatchdog(timeoutMs: number, onStall: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const reset = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      stopped = true;
      onStall();
    }, timeoutMs);
  };
  reset();
  return {
    reset,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

// 一度だけ出る行(開始や終了の合図)。出たら進んだとみなす
const ONE_OFF_KEYS = new Set(['status', 'concat_mode', 'duration']);
// 進み具合を表す値。同じ値が繰り返されるだけ(書き出しが止まっている)なら進んだとみなさない
const PROGRESS_KEYS = new Set(['out_time_ms', 'out_time_us', 'out_time', 'progress']);

/**
 * 出力の 1 行(key=value)が「進んだ」ことを表すかを判定する。
 * ネイティブレンダラーの連結は進み具合が変わらなくても 0.2 秒ごとに同じ値を出し、ffmpeg は progress=continue を
 * 繰り返すので、行を受け取っただけではウォッチドッグを延長しない
 */
export function createProgressObserver() {
  const last = new Map<string, string>();
  return (key: string, value: string): boolean => {
    if (PROGRESS_KEYS.has(key)) {
      if (key === 'progress' && value === 'continue') return false;
      const advanced = last.get(key) !== value;
      last.set(key, value);
      return advanced;
    }
    return ONE_OFF_KEYS.has(key);
  };
}
