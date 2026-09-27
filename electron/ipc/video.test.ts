/**
 * 動画の書き出し・プレビューの競合(「保存後にプロジェクトが変更されました」で止まる問題)の回帰テスト。
 * 実モジュール: electron/ipc/video.ts・operations.ts(videoQueue)・project.ts、ProjectRepository、
 * GenerationJobEngine、画面側の projectStore(IPC は structuredClone で模擬)。
 * モック: electron ランタイム、fileAccess(恒等)、ネイティブレンダラー(小さなファイルを書くだけ)。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const h = vi.hoisted(() => ({
  userData: '',
  listeners: new Map<string, Array<(data: unknown) => void>>(),
  notifications: [] as Array<{ channel: string; revision?: number }>,
  renderDelayMs: 10,
  onPartRender: null as null | (() => void),
  partRenders: 0,
  renderedAudioPaths: [] as string[],
  beforePartRender: null as null | (() => Promise<void>),
  onMediaAccess: null as null | (() => Promise<void>),
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
            h.notifications.push({ channel, revision: (data as { revision?: number })?.revision });
            for (const listener of h.listeners.get(channel) ?? []) listener(data);
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
  fileAccess: () => ({
    media: async (file: string) => {
      const hook = h.onMediaAccess;
      h.onMediaAccess = null;
      await hook?.();
      return file;
    },
    grant: async () => {},
  }),
}));

vi.mock('../video/backend', () => ({
  resolveVideoBackend: async () => ({ id: 'native', rendererPath: '/fake/native' }),
}));

vi.mock('../video/native', async () => {
  const fsp = await import('node:fs/promises');
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    resolveNativeVideoRendererBinary: async () => '/fake/native',
    probeDurationNative: async () => 1.3,
    renderPartVideoNative: async (
      _binary: string,
      request: { outputPath: string; audioPath: string },
      _job: unknown,
      onProgress?: (kv: Record<string, string>) => void
    ) => {
      h.partRenders++;
      h.renderedAudioPaths.push(request.audioPath);
      const before = h.beforePartRender;
      h.beforePartRender = null;
      await before?.();
      const hook = h.onPartRender;
      h.onPartRender = null;
      hook?.();
      await sleep(h.renderDelayMs);
      await fsp.writeFile(request.outputPath, 'part');
      onProgress?.({ out_time_ms: '1300000' });
    },
    concatSegmentsNative: async (_binary: string, request: { outputPath: string }) => {
      await fsp.writeFile(request.outputPath, 'final');
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
  type ImagePrompt,
  type Project,
} from '../../shared/project/schema';
import { isVideoCurrent, partFreshness } from '../../shared/project/integrity';
import { classifyGenerationError } from '../../shared/project/jobs';
import { RENDER_CONFLICT_MARKER } from '../../shared/project/renderIntent';
import { resolutionForAspect, type RenderOptions } from '../../shared/project/videoFormat';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';
import { GenerationJobEngine } from '../jobs/engine';

// 画面側のモジュールは DOM の型に依存するため、Main 用の型検査の対象に入らないよう実行時に読み込む
type ProjectClient = {
  load(id: string): Promise<Project>;
  save(project: Project): Promise<void>;
  flush(id: string): Promise<void>;
  reloadIfClean(id: string): Promise<boolean>;
};
let projectClient: ProjectClient;
let withRenderConflictRetry: <T>(projectId: string, attempt: () => Promise<T>) => Promise<T>;
const rendererModule = (relative: string) =>
  fileURLToPath(new URL(`../../src/${relative}`, import.meta.url));

// VideoManagePage の既定値と同じキー順(projectSchema.outputSettings と同じ)
const options: RenderOptions = {
  videoPartLeadInSec: 0.3,
  openingVideoPath: '',
  endingVideoPath: '',
  resolution: '1280x720',
  fps: 30,
  videoBitrate: '2M',
  audioBitrate: '128k',
  includeOpening: false,
  includeEnding: false,
};
// 同じ値でキー順だけ違う(画面側で組み立て直したときの形)
const optionsOtherOrder: RenderOptions = {
  resolution: '1280x720',
  fps: 30,
  videoBitrate: '2M',
  audioBitrate: '128k',
  videoPartLeadInSec: 0.3,
  openingVideoPath: '',
  endingVideoPath: '',
  includeOpening: false,
  includeEnding: false,
};

beforeAll(async () => {
  h.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-video-'));
  // 画面側: 本物の projectStore を、Main の本物の操作に structuredClone 越しにつなぐ
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      project: {
        load: async (id: string) => structuredClone(await invokeOperation('project:load', id)),
        save: async (project: unknown) =>
          structuredClone(await invokeOperation('project:save', structuredClone(project))),
        onChanged: (callback: (event: unknown) => void) => {
          const list = h.listeners.get('project:changed') ?? [];
          list.push(callback);
          h.listeners.set('project:changed', list);
          return () => {};
        },
      },
    },
  };
  const store = await import(/* @vite-ignore */ rendererModule('stores/projectStore.ts'));
  projectClient = store.projectClient;
  store.initializeProjectEvents();
  ({ withRenderConflictRetry } = await import(
    /* @vite-ignore */ rendererModule('utils/renderRetry.ts')
  ));
});

afterAll(async () => {
  await fs.rm(h.userData, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(30); // project:changed による画面側の再読込を待つ

function imageAsset(filePath: string, promptId?: string): ImageAsset {
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
      promptId,
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

function audioAsset(filePath: string, durationSec = 1): AudioAsset {
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

async function createRenderableProject() {
  const repo = getProjectRepository();
  const draft = createNewProject('Render', '');
  draft.article = { title: 'Source', bodyText: 'A small body.', importedImages: [] };
  const created = await repo.create(draft);
  const imagePath = path.join(created.path, 'images', 'a.png');
  const audioPath = path.join(created.path, 'audio', 'a.wav');
  await fs.writeFile(imagePath, 'img');
  await fs.writeFile(audioPath, 'wav');
  const image = imageAsset(imagePath);
  const audio = audioAsset(audioPath);
  const part = createNewPart(0, { title: 'P1', scriptText: 'Short narration' });
  part.panelImages = [{ imageId: image.id }];
  part.audio = audio;
  const saved = await repo.update(created.id, (data) => {
    data.images = [image];
    data.audio = [audio];
    data.parts = [part];
  });
  expect(partFreshness(saved, saved.parts[0])).toMatchObject({
    script: 'current',
    image: 'current',
    audio: 'current',
  });
  return saved;
}

/** 画面側の再試行なしで、VideoManagePage.handleRender と同じ手順で書き出す(Main 側の判定だけを見る) */
async function exportOnce(id: string, outputPath: string, renderOptions: RenderOptions = options) {
  const project = await projectClient.load(id);
  const renderProject: Project = { ...project, outputSettings: { ...renderOptions } };
  await projectClient.save(renderProject);
  return invokeOperation<{ outputPath: string }>(
    'video:render',
    structuredClone(renderProject),
    { ...renderOptions },
    outputPath
  );
}

/** VideoManagePage.handleRender と同じ手順(競合時は 1 回だけ再読込して再試行) */
function manualExport(id: string, outputPath: string, renderOptions: RenderOptions = options) {
  return withRenderConflictRetry(id, () => exportOnce(id, outputPath, renderOptions));
}

/** VideoManagePage.handleGeneratePreview と同じ手順 */
function manualPreview(id: string, partId: string) {
  return withRenderConflictRetry(id, async () => {
    await projectClient.flush(id);
    const intended = await projectClient.load(id);
    return invokeOperation<{ previewPath: string }>(
      'video:preview',
      partId,
      structuredClone(intended)
    );
  });
}

async function diskRevision(id: string) {
  return (await getProjectRepository().load(id)).revision;
}

function makeEngine(project: Project) {
  const invoke = async (name: string, ...args: unknown[]) => {
    const now = new Date().toISOString();
    if (name === 'ai:generateScript') {
      const part = createNewPart(0, { title: 'P1', scriptText: 'Short narration' });
      return { parts: [part], usage: { model: 'gpt-5.2', inputTokens: 10, outputTokens: 10 } };
    }
    if (name === 'ai:generateImagePromptForTarget')
      return {
        prompt: {
          id: crypto.randomUUID(),
          partId: args[2],
          stylePreset: 'infographic',
          prompt: 'A simple diagram',
          aspectRatio: '16:9',
          version: 0,
          createdAt: now,
        },
        usage: { model: 'gpt-5.2', inputTokens: 10, outputTokens: 10 },
      };
    if (name === 'image:generate') {
      const prompt = args[0] as ImagePrompt;
      const filePath = path.join(project.path, 'images', `${prompt.id}.png`);
      await fs.writeFile(filePath, 'img');
      return imageAsset(filePath, prompt.id);
    }
    if (name === 'tts:generate') {
      const filePath = path.join(project.path, 'audio', `${crypto.randomUUID()}.wav`);
      await fs.writeFile(filePath, 'wav');
      return {
        audio: audioAsset(filePath),
        usage: { model: DEFAULT_SETTINGS.ttsModel, inputTokens: 10, outputTokens: 10 },
      };
    }
    if (name === 'video:render') return invokeOperation(name, ...args); // 本物のハンドラと待ち行列
    throw new Error(`Unexpected operation: ${name}`);
  };
  const engine = new GenerationJobEngine(
    getProjectRepository(),
    invoke as <T>(name: string, ...args: unknown[]) => Promise<T>,
    async () => ({ ...DEFAULT_SETTINGS }),
    (saved) => {
      for (const listener of h.listeners.get('project:changed') ?? [])
        listener({ id: saved.id, revision: saved.revision });
    }
  );
  return { engine, invoke };
}

async function createArticleProject(name: string) {
  const draft = createNewProject(name, '');
  draft.article = {
    title: `${name} source`,
    bodyText: 'Body text for the job.',
    importedImages: [],
  };
  return getProjectRepository().create(draft);
}

describe('manual export and preview', () => {
  it('exports repeatedly when nothing else touches the project', async () => {
    const project = await createRenderableProject();
    await projectClient.load(project.id);
    const out = path.join(project.path, 'output', 'out.mp4');
    await expect(exportOnce(project.id, out)).resolves.toEqual({ outputPath: out });
    await settle();
    await expect(exportOnce(project.id, out)).resolves.toEqual({ outputPath: out });
  });

  it('exports after a preview without any renderer retry (was: 保存後にプロジェクトが変更されました)', async () => {
    const project = await createRenderableProject();
    await projectClient.load(project.id);
    const out = path.join(project.path, 'output', 'out.mp4');
    await exportOnce(project.id, out);
    await settle();
    await invokeOperation('video:preview', project.parts[0].id);
    for (let i = 0; i < 3; i++) {
      await expect(exportOnce(project.id, out)).resolves.toEqual({ outputPath: out });
      await settle();
    }
    const saved = await getProjectRepository().load(project.id);
    expect(saved.metrics).toMatchObject({ renderAttempts: 4, renderFailures: 0 });
  });

  it('exports after a preview when the screen rebuilt the options in a different key order', async () => {
    const project = await createRenderableProject();
    await projectClient.load(project.id);
    const out = path.join(project.path, 'output', 'out.mp4');
    await exportOnce(project.id, out);
    await settle();
    await invokeOperation('video:preview', project.parts[0].id);
    await expect(exportOnce(project.id, out, optionsOtherOrder)).resolves.toEqual({
      outputPath: out,
    });
  });

  it('notifies the screen whenever the main process saves during preview and export', async () => {
    const project = await createRenderableProject();
    await projectClient.load(project.id);
    const out = path.join(project.path, 'output', 'out.mp4');
    await exportOnce(project.id, out);
    await settle();
    await manualPreview(project.id, project.parts[0].id);
    await settle();
    // プレビュー時のメトリクス更新も通知されるので、画面側の保持データはディスクと同じリビジョンになる
    expect((await projectClient.load(project.id)).revision).toBe(await diskRevision(project.id));
    h.notifications.length = 0;
    let atRenderStart: { disk?: number; notified?: number } = {};
    h.beforePartRender = async () => {
      atRenderStart = {
        disk: await diskRevision(project.id),
        notified: h.notifications.filter((item) => item.channel === 'project:changed').at(-1)
          ?.revision,
      };
    };
    await exportOnce(project.id, out);
    await settle();
    // 書き出し開始時の出力設定の保存も、パートの書き出しより前に通知されている
    expect(atRenderStart.disk).toBeDefined();
    expect(atRenderStart.notified).toBe(atRenderStart.disk);
    const disk = await diskRevision(project.id);
    const notified = h.notifications
      .filter((item) => item.channel === 'project:changed')
      .map((item) => item.revision);
    // 出力設定の保存・完了の記録・メトリクスのすべての保存が通知される(抜けがない)
    expect(notified.at(-1)).toBe(disk);
    expect(new Set(notified).size).toBe(notified.length);
    expect((await projectClient.load(project.id)).revision).toBe(disk);
  });

  it('rejects an export only when the content to export really changed', async () => {
    const project = await createRenderableProject();
    const captured = structuredClone(await projectClient.load(project.id));
    const out = path.join(project.path, 'output', 'out.mp4');
    // 画面が保持した後に、Main 側(ジョブなど)でパートの音声が差し替わった
    const newAudioPath = path.join(project.path, 'audio', 'b.wav');
    await fs.writeFile(newAudioPath, 'wav');
    await getProjectRepository().update(project.id, (data) => {
      const audio = audioAsset(newAudioPath, 2);
      data.audio.push(audio);
      data.parts[0].audio = audio;
    });
    const rendersBefore = h.partRenders;
    const error = await invokeOperation(
      'video:render',
      { ...captured, outputSettings: options },
      options,
      out
    ).catch((failure: unknown) => failure);
    expect(String(error)).toContain(RENDER_CONFLICT_MARKER);
    expect(String(error)).toContain('変更されました');
    expect(classifyGenerationError(error).kind).toBe('conflict');
    expect(h.partRenders).toBe(rendersBefore);
  });

  it('rejects an export when the content changes while its inputs are being checked', async () => {
    const project = await createRenderableProject();
    await projectClient.load(project.id);
    const out = path.join(project.path, 'output', 'out.mp4');
    const newAudioPath = path.join(project.path, 'audio', 'd.wav');
    await fs.writeFile(newAudioPath, 'wav');
    const before = await getProjectRepository().load(project.id);
    // 最新を読んで照合した後、出力設定を保存する前に別の保存で音声が差し替わる
    let revisionAfterEdit: number | undefined;
    h.onMediaAccess = async () => {
      const edited = await getProjectRepository().update(project.id, (data) => {
        const audio = audioAsset(newAudioPath, 4);
        data.audio.push(audio);
        data.parts[0].audio = audio;
      });
      revisionAfterEdit = edited.revision;
    };
    const rendersBefore = h.partRenders;
    await expect(exportOnce(project.id, out)).rejects.toThrow(RENDER_CONFLICT_MARKER);
    expect(h.partRenders).toBe(rendersBefore);
    const saved = await getProjectRepository().load(project.id);
    expect(saved.parts[0].audio?.filePath).toBe(newAudioPath);
    // 出力設定もメトリクスも保存していない(差し替え後のリビジョンのまま)
    expect(revisionAfterEdit).toBeDefined();
    expect(saved.revision).toBe(revisionAfterEdit);
    expect(saved.metrics?.renderFailures ?? 0).toBe(before.metrics?.renderFailures ?? 0);
  });

  it('rejects a preview only when the previewed part really changed', async () => {
    const project = await createRenderableProject();
    const captured = structuredClone(await getProjectRepository().load(project.id));
    // 別のパートやメトリクスの変更では失敗しない
    await getProjectRepository().update(project.id, (data) => {
      data.metrics = { ...data.metrics!, renderAttempts: 9 };
      data.presentationProfile.closingCardHeadline = 'changed';
    });
    await expect(
      invokeOperation('video:preview', project.parts[0].id, captured)
    ).resolves.toMatchObject({ previewPath: expect.stringContaining('preview-part-1') });
    // プレビューするパートの画像が差し替わったら失敗する
    const newImagePath = path.join(project.path, 'images', 'b.png');
    await fs.writeFile(newImagePath, 'img');
    await getProjectRepository().update(project.id, (data) => {
      const image = imageAsset(newImagePath);
      data.images.push(image);
      data.parts[0].panelImages = [{ imageId: image.id }];
    });
    await expect(invokeOperation('video:preview', project.parts[0].id, captured)).rejects.toThrow(
      RENDER_CONFLICT_MARKER
    );
  });

  it('reloads and retries once when the screen has no unsaved changes', async () => {
    const project = await createRenderableProject();
    await projectClient.load(project.id);
    const out = path.join(project.path, 'output', 'out.mp4');
    const newAudioPath = path.join(project.path, 'audio', 'c.wav');
    await fs.writeFile(newAudioPath, 'wav');
    // 通知なしで Main 側の内容が変わる(画面側は古い音声を保持したまま)
    await getProjectRepository().update(project.id, (data) => {
      const audio = audioAsset(newAudioPath, 3);
      data.audio.push(audio);
      data.parts[0].audio = audio;
    });
    h.renderedAudioPaths.length = 0;
    await expect(manualExport(project.id, out)).resolves.toEqual({ outputPath: out });
    // 古い内容ではなく、保存済みの最新の音声で書き出している
    expect(h.renderedAudioPaths).toEqual([newAudioPath]);
    const saved = await getProjectRepository().load(project.id);
    expect(saved.autoGenerationStatus?.lastVideoPath).toBe(out);
    expect(isVideoCurrent(saved)).toBe(true);
    expect((await projectClient.load(project.id)).parts[0].audio?.filePath).toBe(newAudioPath);
  });
});

describe('manual operations and the automatic generation job', () => {
  it('lets a manual export queued during the job render succeed after the job', async () => {
    const created = await createArticleProject('Auto');
    await projectClient.load(created.id);
    h.renderDelayMs = 150;
    let manual: Promise<unknown> | null = null;
    h.onPartRender = () => {
      // ジョブの書き出し中に、動画画面で書き出しが押された(画面では無効化しているが、Main 側でも安全)
      const s = DEFAULT_SETTINGS;
      const pageDefaults: RenderOptions = {
        videoPartLeadInSec: s.videoPartLeadInSec,
        openingVideoPath: s.openingVideoPath,
        endingVideoPath: s.endingVideoPath,
        resolution: s.videoResolution,
        fps: s.videoFps,
        videoBitrate: s.videoBitrate,
        audioBitrate: s.audioBitrate,
        includeOpening: Boolean(s.openingVideoPath),
        includeEnding: Boolean(s.endingVideoPath),
      };
      manual = manualExport(
        created.id,
        path.join(created.path, 'output', 'manual.mp4'),
        pageDefaults
      ).then(
        (value) => ({ ok: value }),
        (error) => ({ error: String(error) })
      );
    };
    try {
      const { engine } = makeEngine(created);
      await engine.start(created.id, { mode: 'automatic', targetPartCount: 1 });
      await engine.wait(created.id);
      expect(manual).not.toBeNull();
      const manualResult = await manual!;
      expect(manualResult).toEqual({
        ok: { outputPath: path.join(created.path, 'output', 'manual.mp4') },
      });
      expect((await getProjectRepository().load(created.id)).job?.status).toBe('completed');
    } finally {
      h.renderDelayMs = 10;
      h.onPartRender = null;
    }
  });

  it('completes the job when a preview is queued just before its render', async () => {
    const created = await createArticleProject('Auto2');
    const { engine, invoke } = makeEngine(created);
    let preview: Promise<unknown> | null = null;
    const wrapped = async (name: string, ...args: unknown[]) => {
      if (name === 'video:render') {
        const current = await getProjectRepository().load(created.id);
        preview = invokeOperation('video:preview', current.parts[0].id).catch(String);
        await sleep(0);
      }
      return invoke(name, ...args);
    };
    (engine as unknown as { invoke: typeof wrapped }).invoke = wrapped;
    await engine.start(created.id, { mode: 'automatic', targetPartCount: 1 });
    await engine.wait(created.id);
    await expect(preview!).resolves.toMatchObject({ previewPath: expect.any(String) });
    const saved = await getProjectRepository().load(created.id);
    expect(saved.job?.error).toBeUndefined();
    expect(saved.job?.status).toBe('completed');
  });

  it('completes the job when an unrelated edit lands while its render waits in the queue', async () => {
    const created = await createArticleProject('Auto3');
    const { engine, invoke } = makeEngine(created);
    const wrapped = async (name: string, ...args: unknown[]) => {
      if (name === 'video:render') {
        // 書き出し内容に関係しない更新(使っていない記事画像の追加)
        const imagePath = path.join(created.path, 'images', 'imported', 'unused.png');
        await fs.writeFile(imagePath, 'img');
        await getProjectRepository().update(created.id, (data) => {
          data.article.importedImages.push({ ...imageAsset(imagePath), sourceType: 'imported' });
        });
      }
      return invoke(name, ...args);
    };
    (engine as unknown as { invoke: typeof wrapped }).invoke = wrapped;
    await engine.start(created.id, { mode: 'automatic', targetPartCount: 1 });
    await engine.wait(created.id);
    const saved = await getProjectRepository().load(created.id);
    expect(saved.job?.error).toBeUndefined();
    expect(saved.job?.status).toBe('completed');
    expect(saved.article.importedImages).toHaveLength(1);
    expect(isVideoCurrent(saved)).toBe(true);
  });

  it('exports three times after the job completes and the user previews', async () => {
    const created = await createArticleProject('Auto4');
    await projectClient.load(created.id);
    const { engine } = makeEngine(created);
    await engine.start(created.id, { mode: 'automatic', targetPartCount: 1 });
    await engine.wait(created.id);
    await settle();
    const project = await projectClient.load(created.id);
    expect(project.job?.status).toBe('completed');
    const s = DEFAULT_SETTINGS;
    // VideoManagePage の既定値と保存済みの出力設定の組み立て
    const renderOptions: RenderOptions = {
      videoPartLeadInSec: s.videoPartLeadInSec,
      openingVideoPath: s.openingVideoPath,
      endingVideoPath: s.endingVideoPath,
      resolution: resolutionForAspect(s.videoResolution, project.presentationProfile.aspectRatio),
      fps: s.videoFps,
      videoBitrate: s.videoBitrate,
      audioBitrate: s.audioBitrate,
      includeOpening: Boolean(s.openingVideoPath),
      includeEnding: Boolean(s.endingVideoPath),
      ...project.outputSettings,
    } as RenderOptions;
    const out = path.join(created.path, 'output', 'manual.mp4');
    await manualPreview(created.id, project.parts[0].id); // 「プレビュー確認後に最終書き出し」
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        await exportOnce(created.id, out, renderOptions).then(
          () => 'ok',
          (error) => String(error)
        )
      );
      await settle();
    }
    expect(results).toEqual(['ok', 'ok', 'ok']);
  });
});
