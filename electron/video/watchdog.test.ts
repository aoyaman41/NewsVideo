import { afterAll, beforeAll, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyGenerationError } from '../../shared/project/jobs';
import { runFfmpeg, type VideoJob } from './ffmpeg';
import { concatSegmentsNative, renderPartVideoNative } from './native';

let root: string;
let silent: string;
let chatty: string;
let concat: string;
let repeating: string;

async function script(name: string, body: string) {
  const file = path.join(root, name);
  await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-watchdog-'));
  // 進捗を出さずに止まったままのプロセス(本物のレンダラーと同じく 1 つのプロセス)
  silent = await script('silent', 'exec sleep 30');
  // 進捗を出し続けてから正常に終わるプロセス(合計はタイムアウトより長い)
  chatty = await script(
    'chatty',
    'for i in 1 2 3 4 5 6; do echo "out_time_ms=$((i * 500000))"; sleep 0.1; done; echo status=ok'
  );
  concat = await script(
    'concat',
    'echo concat_mode=passthrough; echo progress=1.0; echo status=ok'
  );
  // 進み具合が変わらないまま同じ値を出し続ける(連結が止まった状態)
  repeating = await script('repeating', 'echo concat_mode=passthrough; exec yes progress=0.4000');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const job = (stallTimeoutMs: number): VideoJob => ({
  canceled: false,
  processes: new Set(),
  stallTimeoutMs,
});

const partRequest = {
  outputPath: '/tmp/unused.mp4',
  width: 320,
  height: 240,
  fps: 30,
  videoBitrate: '1M',
  audioBitrate: '128k',
  audioPath: '/tmp/unused.wav',
  audioDelayMs: 0,
  imageEntries: [{ filePath: '/tmp/unused.png', durationSec: 1 }],
};

it('stops a native export that stops reporting progress and explains it', async () => {
  const running = job(200);
  const started = Date.now();
  const error = await renderPartVideoNative(silent, partRequest, running).catch((e) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain('進まなかったため中断しました');
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(running.processes.size).toBe(0);
  // 自動生成ジョブでは一時的な失敗(再試行できる)として扱う
  expect(classifyGenerationError(error)).toMatchObject({ kind: 'transient', retryable: true });
});

it('keeps a native export running while it reports progress', async () => {
  const progress: string[] = [];
  await renderPartVideoNative(chatty, partRequest, job(250), (record) => {
    if (record.out_time_ms) progress.push(record.out_time_ms);
  });
  expect(progress).toHaveLength(6);
});

it('reports whether segments were joined without re-encoding', async () => {
  const result = await concatSegmentsNative(
    concat,
    { ...partRequest, segmentPaths: ['/tmp/a.mp4', '/tmp/b.mp4'] },
    job(1_000)
  );
  expect(result).toEqual({ mode: 'passthrough' });
});

it('does not treat the same progress value repeated over and over as progress', async () => {
  const error = await concatSegmentsNative(
    repeating,
    { ...partRequest, segmentPaths: ['/tmp/a.mp4'] },
    job(300)
  ).catch((e) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain('進まなかったため中断しました');
});

it('stops an ffmpeg process that stops reporting progress', async () => {
  const error = await runFfmpeg(silent, ['-i', 'x'], job(200)).catch((e) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain('進まなかったため中断しました');
});

it('reports cancellation rather than a stall when the job is stopped', async () => {
  const running = job(5_000);
  const pending = renderPartVideoNative(silent, partRequest, running).catch((e) => e);
  await new Promise((resolve) => setTimeout(resolve, 100));
  running.canceled = true;
  for (const proc of running.processes) proc.kill('SIGTERM');
  const error = await pending;
  expect(error.message).toBe('キャンセルしました');
});
