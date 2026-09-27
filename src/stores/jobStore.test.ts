import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GenerationJob } from '../../shared/project/jobs';
import {
  dismissJob,
  ensureJobEvents,
  getTrackedJob,
  isJobDismissed,
  onJobTransition,
  receiveJobEvent,
  resetJobStoreForTest,
} from './jobStore';

const projectId = '00000000-0000-4000-8000-00000000000a';

function job(patch: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'running',
    stage: '台本',
    mode: 'automatic',
    targetPartCount: 3,
    startedAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
    completed: [],
    outputs: [],
    reviewedStages: [],
    cancelRequested: false,
    settings: {},
    spentUsd: 0,
    estimatedRemainingUsd: 0,
    unknownCharges: 0,
    ...patch,
  };
}

let handler: ((payload: unknown) => void) | null = null;
const subscribe = vi.fn((_channel: string, callback: (payload: unknown) => void) => {
  handler = callback;
  return () => {
    handler = null;
  };
});

beforeEach(() => {
  resetJobStoreForTest();
  vi.stubGlobal('window', { electronAPI: { events: { subscribe } } });
});
afterEach(() => {
  resetJobStoreForTest();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('subscribes to job:statusChange only once', () => {
  ensureJobEvents();
  ensureJobEvents();
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledWith('job:statusChange', expect.any(Function));
  handler?.({ projectId, job: job() });
  expect(getTrackedJob(projectId)?.job.status).toBe('running');
});

it('keeps the latest job and reads progress written by the engine', () => {
  receiveJobEvent({ projectId, job: job() });
  receiveJobEvent({
    projectId,
    job: job({ stage: '画像', progress: { image: { done: 1, total: 3 } } }),
  });
  expect(getTrackedJob(projectId)?.job.progress?.image).toEqual({ done: 1, total: 3 });
});

it('ignores malformed payloads and forgets a project whose job disappeared', () => {
  receiveJobEvent(null);
  receiveJobEvent({ projectId: 1, job: job() });
  receiveJobEvent({ projectId, job: { status: 'running' } });
  expect(getTrackedJob(projectId)).toBeUndefined();
  receiveJobEvent({ projectId, job: job() });
  receiveJobEvent({ projectId, job: undefined });
  expect(getTrackedJob(projectId)).toBeUndefined();
});

it('notifies transitions once per status change', () => {
  const listener = vi.fn();
  const stop = onJobTransition(listener);
  receiveJobEvent({ projectId, job: job() });
  receiveJobEvent({ projectId, job: job({ stage: '画像' }) });
  receiveJobEvent({ projectId, job: job({ status: 'completed', stage: '完了' }) });
  expect(listener.mock.calls.map(([transition]) => transition.job.status)).toEqual([
    'running',
    'completed',
  ]);
  expect(listener.mock.calls[1][0].previousStatus).toBe('running');
  stop();
  receiveJobEvent({ projectId, job: job({ status: 'failed' }) });
  expect(listener).toHaveBeenCalledTimes(2);
});

it('remembers dismissed banners', () => {
  expect(isJobDismissed('a')).toBe(false);
  dismissJob('a');
  dismissJob('a');
  expect(isJobDismissed('a')).toBe(true);
});

it('shows a banner again when a dismissed job is resumed and stops again', () => {
  const failed = job({ status: 'failed' });
  receiveJobEvent({ projectId, job: failed });
  const key = `${failed.id}:failed:`;
  dismissJob(key);
  expect(isJobDismissed(key)).toBe(true);
  receiveJobEvent({ projectId, job: job({ status: 'running' }) });
  expect(isJobDismissed(key)).toBe(false);
});
