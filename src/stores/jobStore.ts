import { useSyncExternalStore } from 'react';
import { jobSchema, type GenerationJob } from '../../shared/project/jobs';

/**
 * 自動生成ジョブの状態を、どの画面にいても追えるようにする。Main の job:statusChange イベントを
 * アプリ全体で 1 回だけ購読し、プロジェクトごとの最新のジョブを覚える。
 * このセッションでイベントを受け取ったジョブは「今動いた(live)」ものとして扱い、完了の通知に使う。
 */

export type TrackedJob = {
  projectId: string;
  job: GenerationJob;
  /** 受け取った順番。新しいものほど大きい */
  sequence: number;
};

export type JobTransition = {
  projectId: string;
  job: GenerationJob;
  previousStatus: GenerationJob['status'] | null;
};

type Snapshot = {
  jobs: ReadonlyMap<string, TrackedJob>;
  dismissed: ReadonlySet<string>;
};

let snapshot: Snapshot = { jobs: new Map(), dismissed: new Set() };
let sequence = 0;
let unsubscribeEvents: (() => void) | null = null;
const listeners = new Set<() => void>();
const transitionListeners = new Set<(transition: JobTransition) => void>();

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/** job:statusChange の中身を取り込む。形が合わないものは無視する */
export function receiveJobEvent(payload: unknown): void {
  const event = payload as { projectId?: unknown; job?: unknown } | null;
  if (!event || typeof event.projectId !== 'string') return;
  const projectId = event.projectId;
  if (event.job === undefined || event.job === null) {
    if (!snapshot.jobs.has(projectId)) return;
    const jobs = new Map(snapshot.jobs);
    jobs.delete(projectId);
    emit({ ...snapshot, jobs });
    return;
  }
  const parsed = jobSchema.safeParse(event.job);
  if (!parsed.success) return;
  const job = parsed.data;
  const previous = snapshot.jobs.get(projectId);
  const jobs = new Map(snapshot.jobs);
  jobs.set(projectId, { projectId, job, sequence: ++sequence });
  // 再開して動き出したジョブは、以前に閉じた表示(失敗・停止など)を忘れる。再び止まったら表示する
  let dismissed = snapshot.dismissed;
  if (job.status === 'running' || job.status === 'queued') {
    const prefix = `${job.id}:`;
    if ([...dismissed].some((key) => key.startsWith(prefix)))
      dismissed = new Set([...dismissed].filter((key) => !key.startsWith(prefix)));
  }
  emit({ jobs, dismissed });
  const previousStatus = previous && previous.job.id === job.id ? previous.job.status : null;
  if (previousStatus !== job.status) {
    const transition = { projectId, job, previousStatus };
    transitionListeners.forEach((listener) => listener(transition));
  }
}

/** イベントの購読を始める(何度呼んでも 1 回だけ) */
export function ensureJobEvents(): void {
  if (unsubscribeEvents) return;
  const events = typeof window !== 'undefined' ? window.electronAPI?.events : undefined;
  if (!events) return;
  unsubscribeEvents = events.subscribe('job:statusChange', receiveJobEvent);
}

export function dismissJob(key: string): void {
  if (snapshot.dismissed.has(key)) return;
  emit({ ...snapshot, dismissed: new Set([...snapshot.dismissed, key]) });
}

export function isJobDismissed(key: string): boolean {
  return snapshot.dismissed.has(key);
}

export function getTrackedJob(projectId: string): TrackedJob | undefined {
  return snapshot.jobs.get(projectId);
}

/** 状態が変わったとき(完了・失敗など)に呼ばれる。戻り値で購読をやめる */
export function onJobTransition(listener: (transition: JobTransition) => void): () => void {
  transitionListeners.add(listener);
  return () => {
    transitionListeners.delete(listener);
  };
}

function subscribe(listener: () => void) {
  ensureJobEvents();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useJobFeed(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** テスト用: 状態を初期化する */
export function resetJobStoreForTest(): void {
  unsubscribeEvents?.();
  unsubscribeEvents = null;
  sequence = 0;
  snapshot = { jobs: new Map(), dismissed: new Set() };
  listeners.clear();
  transitionListeners.clear();
}
