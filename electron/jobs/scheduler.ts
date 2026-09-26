/**
 * ジョブ内の並列処理の実行管理。
 * - 種類(画像プロンプト・画像・音声)ごとに同時に走らせる数を制限する
 * - 1 件でも失敗したら(または停止・予算の判定で止めたら)新しい処理は始めず、実行中のものは完了まで待つ
 *   (実行中の処理はそれぞれ自分の結果を保存する)
 */
export class StagePool<Kind extends string> {
  private active = new Map<Kind, number>();
  private waiting = new Map<Kind, Array<(run: boolean) => void>>();
  private tasks = new Set<Promise<void>>();
  private stopped: { reason: unknown } | null = null;
  private signalStopped!: () => void;
  /** 止めたときに解決する(待ち合わせの解除に使う) */
  readonly whenStopped = new Promise<void>((resolve) => (this.signalStopped = resolve));

  constructor(private limits: Record<Kind, number>) {}

  get isStopped() {
    return this.stopped !== null;
  }

  /** 新しい処理を始めないようにする。最初の理由だけを記録する */
  stop(reason: unknown) {
    if (this.stopped) return;
    this.stopped = { reason };
    this.signalStopped();
    for (const queue of this.waiting.values())
      for (const resolve of queue.splice(0)) resolve(false);
  }

  /**
   * 枠が空いたら work を始める。止めた後は始めない。work が失敗したらプール全体を止める。
   * work の中から続きの処理を schedule してよい(settle はそれも待つ)
   */
  schedule(kind: Kind, work: () => Promise<void>) {
    this.track(
      (async () => {
        if (!(await this.acquire(kind))) return;
        try {
          await work();
        } catch (error) {
          this.stop(error);
        } finally {
          this.release(kind);
        }
      })()
    );
  }

  /** gate を待ってから then を呼ぶ(止めた後は呼ばない) */
  after(gate: Promise<unknown>, then: () => void) {
    this.track(
      (async () => {
        await gate.catch(() => {});
        if (!this.stopped) then();
      })()
    );
  }

  /** すべての処理(途中で追加されたものを含む)が終わるまで待ち、止めた理由を返す */
  async settle(): Promise<{ reason: unknown } | null> {
    while (this.tasks.size > 0) await Promise.allSettled([...this.tasks]);
    return this.stopped;
  }

  private track(task: Promise<void>) {
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
  }

  private async acquire(kind: Kind): Promise<boolean> {
    if (this.stopped) return false;
    const active = this.active.get(kind) ?? 0;
    const queue = this.waiting.get(kind) ?? [];
    if (active < Math.max(1, this.limits[kind]) && queue.length === 0) {
      this.active.set(kind, active + 1);
      return true;
    }
    return new Promise<boolean>((resolve) => {
      queue.push(resolve);
      this.waiting.set(kind, queue);
    });
  }

  private release(kind: Kind) {
    const next = this.stopped ? undefined : this.waiting.get(kind)?.shift();
    // 待っている処理があれば枠をそのまま引き渡す
    if (next) next(true);
    else this.active.set(kind, (this.active.get(kind) ?? 1) - 1);
  }
}
