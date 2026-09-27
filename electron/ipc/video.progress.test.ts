/**
 * 書き出しの進捗・停止の回帰テスト(M2)。
 * - 進捗が自動生成ジョブ(job.progress.video)と画面(progress:update)の両方に流れること
 * - 書き出しをプロジェクト・依頼元ごとに管理し、画面からの停止が別のプロジェクトやジョブの書き出しを止めないこと
 * - ジョブの停止で書き出し中の処理が止まること
 * モック: electron ランタイム、fileAccess(恒等)、ネイティブレンダラー(進捗を出しながら停止を待つ)。
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type Job = { canceled: boolean };
const h = vi.hoisted(() => ({
  userData: '',
  progress: [] as Array<Record<string, unknown>>,
  /** true の間、パートの書き出しは停止されるまで終わらない */
  holdParts: false,
  partStarted: 0,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: () => {} },
  app: {
    getPath: () => h.userData,
    isPackaged: false,
    getAppPath: () => '/',
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (channel: string, data: unknown) => {
            if (channel === 'progress:update') h.progress.push(data as Record<string, unknown>);
          },
        },
      },
    ],
    getFocusedWindow: () => null,
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock('../utils/fileAccess', () => ({
  fileAccess: () => ({ media: async (file: string) => file, grant: async () => {} }),
}));

vi.mock('../video/backend', () => ({
  resolveVideoBackend: async () => ({ id: 'native', rendererPath: '/fake/native' }),
}));

vi.mock('../video/native', async () => {
  const fsp = await import('node:fs/promises');
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    resolveNativeVideoRendererBinary: async () => '/fake/native',
    probeDurationNative: async () => 2,
    renderPartVideoNative: async (
      _binary: string,
      request: { outputPath: string; imageEntries: Array<{ durationSec: number }> },
      job: Job,
      onProgress?: (kv: Record<string, string>) => void
    ) => {
      h.partStarted++;
      const total = request.imageEntries.reduce((sum, entry) => sum + entry.durationSec, 0);
      // 映像 0.5 秒ごとの進捗(本物のレンダラーと同じ形式。out_time_ms はマイクロ秒)
      for (let time = 0.5; time <= total; time += 0.5) {
        if (job.canceled) throw new Error('キャンセルしました');
        onProgress?.({ out_time_ms: String(Math.round(time * 1_000_000)) });
        await sleep(30);
      }
      while (h.holdParts) {
        if (job.canceled) throw new Error('キャンセルしました');
        await sleep(2);
      }
      await fsp.writeFile(request.outputPath, 'part');
    },
    concatSegmentsNative: async (
      _binary: string,
      request: { outputPath: string },
      _job: Job,
      onProgress?: (kv: Record<string, string>) => void
    ) => {
      for (const fraction of ['0.25', '0.5', '1.0']) {
        await sleep(210);
        onProgress?.({ progress: fraction });
      }
      await fsp.writeFile(request.outputPath, 'final');
      return { mode: 'passthrough' };
    },
    normalizeVideoClipNative: async (_binary: string, request: { outputPath: string }) => {
      await fsp.writeFile(request.outputPath, 'clip');
    },
    renderClosingCardVideoNative: async (_binary: string, request: { outputPath: string }) => {
      await fsp.writeFile(request.outputPath, 'card');
    },
  };
});

import { invokeOperation } from './operations';
import { getProjectRepository } from './project';
import './video';
import {
  createNewPart,
  createNewProject,
  type AudioAsset,
  type ImageAsset,
  type Project,
} from '../../shared/project/schema';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';
import type { RenderOptions } from '../../shared/project/videoFormat';
import { jobOperationContext, type RenderProgress } from '../utils/generationContext';

const options: RenderOptions = {
  videoPartLeadInSec: 0.5,
  resolution: '1280x720',
  fps: 30,
  videoBitrate: '2M',
  audioBitrate: '128k',
  includeOpening: false,
  includeEnding: false,
};

beforeAll(async () => {
  h.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-video-progress-'));
});
afterAll(async () => {
  await fs.rm(h.userData, { recursive: true, force: true });
});
beforeEach(() => {
  h.progress.length = 0;
  h.holdParts = false;
  h.partStarted = 0;
});

function imageAsset(filePath: string): ImageAsset {
  return {
    id: crypto.randomUUID(),
    filePath,
    sourceType: 'generated',
    metadata: {
      width: 1280,
      height: 720,
      mimeType: 'image/png',
      fileSize: 3,
      createdAt: new Date().toISOString(),
      tags: [],
      generation: {
        model: DEFAULT_SETTINGS.imageModel,
        resolution: 'fhd',
        imageSizeTier: '1K',
        aspectRatio: '16:9',
        inputTokens: 10,
        outputTokens: 10,
      },
    },
  };
}

function audioAsset(filePath: string, durationSec: number): AudioAsset {
  return {
    id: crypto.randomUUID(),
    filePath,
    durationSec,
    ttsEngine: 'gemini_tts',
    voiceId: 'test',
    settings: { speakingRate: 1, pitch: 0, languageCode: 'ja-JP' },
    generatedAt: new Date().toISOString(),
  };
}

/** 長さの違う 2 シーンのプロジェクト(進捗の重み付けを確かめるため、2 つ目を 3 倍の長さにする) */
async function createProject(name: string): Promise<Project> {
  const repo = getProjectRepository();
  const draft = createNewProject(name, '');
  draft.article = { title: 'Source', bodyText: 'A small body.', importedImages: [] };
  draft.presentationProfile.closingCardEnabled = false;
  const created = await repo.create(draft);
  const images: ImageAsset[] = [];
  const audios: AudioAsset[] = [];
  const parts = [1, 3].map((duration, index) => {
    const image = imageAsset(path.join(created.path, 'images', `${index}.png`));
    const audio = audioAsset(path.join(created.path, 'audio', `${index}.wav`), duration);
    images.push(image);
    audios.push(audio);
    const part = createNewPart(index, { title: `P${index + 1}`, scriptText: `Narration ${index}` });
    part.panelImages = [{ imageId: image.id }];
    part.audio = audio;
    return part;
  });
  for (const file of [...images, ...audios]) await fs.writeFile(file.filePath, 'x');
  return repo.update(created.id, (data) => {
    data.images = images;
    data.audio = audios;
    data.parts = parts;
  });
}

function render(project: Project, context?: Parameters<typeof jobOperationContext.run>[0]) {
  const run = () =>
    invokeOperation<{ outputPath: string }>(
      'video:render',
      structuredClone(project),
      { ...options },
      path.join(project.path, 'output', 'out.mp4')
    );
  return context ? jobOperationContext.run(context, run) : run();
}

it('streams weighted progress to the job and to the screen with the project and requester', async () => {
  const project = await createProject('Progress');
  const jobProgress: RenderProgress[] = [];
  await render(project, { onRenderProgress: (progress) => jobProgress.push(progress) });

  const percents = jobProgress.map((progress) => progress.percent);
  // 画面への送信は 0.2 秒に 1 回までに間引くが、段階の切り替わりと途中の進み具合は届く
  expect(percents.length).toBeGreaterThanOrEqual(6);
  expect(percents).toEqual([...percents].sort((a, b) => a - b));
  expect(percents.at(-1)).toBe(100);
  // シーン 1(1 秒 + 0.5 秒)は、シーン 2(3 秒 + 0.5 秒)より進捗の幅が狭い(長さで重み付けする)
  const firstScene = jobProgress.filter((item) => item.message === 'シーン 1 / 2 を書き出し中');
  const secondScene = jobProgress.filter((item) => item.message === 'シーン 2 / 2 を書き出し中');
  expect(firstScene.length).toBeGreaterThan(0);
  expect(secondScene.length).toBeGreaterThan(0);
  expect(Math.max(...firstScene.map((item) => item.percent))).toBeLessThanOrEqual(30);
  // 連結にも進捗を付ける
  expect(
    jobProgress.some((item) => item.message === 'シーンをつなぎ合わせ中' && item.percent > 90)
  ).toBe(true);

  expect(h.progress.length).toBeGreaterThan(0);
  expect(
    h.progress.every(
      (payload) =>
        payload.source === 'video' &&
        payload.projectId === project.id &&
        payload.origin === 'job' &&
        payload.kind === 'render'
    )
  ).toBe(true);
});

it('stops only the manual export of the requested project from the screen', async () => {
  const project = await createProject('Manual');
  h.holdParts = true;
  const exporting = render(project);
  await vi.waitFor(() => expect(h.partStarted).toBe(1));
  await invokeOperation('video:cancelRender', crypto.randomUUID());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(h.partStarted).toBe(1);
  await invokeOperation('video:cancelRender', project.id);
  await expect(exporting).rejects.toThrow('キャンセルしました');
  expect(h.progress.every((payload) => payload.origin === 'manual')).toBe(true);
});

it('does not stop a job export from the screen but stops it with the job signal', async () => {
  const project = await createProject('Job');
  const controller = new AbortController();
  h.holdParts = true;
  const exporting = render(project, { signal: controller.signal });
  await vi.waitFor(() => expect(h.partStarted).toBe(1));
  await invokeOperation('video:cancelRender');
  await invokeOperation('video:cancelRender', project.id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  let settled = false;
  void exporting.then(
    () => (settled = true),
    () => (settled = true)
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(settled).toBe(false);
  controller.abort();
  await expect(exporting).rejects.toThrow('キャンセルしました');
});

it('refuses to start a job export that was already stopped while it waited in the queue', async () => {
  const project = await createProject('Queued');
  const controller = new AbortController();
  controller.abort();
  await expect(render(project, { signal: controller.signal })).rejects.toThrow(
    'キャンセルしました'
  );
  expect(h.partStarted).toBe(0);
});
