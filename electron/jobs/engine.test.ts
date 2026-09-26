import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createNewPart,
  createNewProject,
  type ImagePrompt,
  type Project,
} from '../../shared/project/schema';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';
import { partFreshness } from '../../shared/project/integrity';
import { ProjectRepository } from '../project/repository';
import { jobOperationContext } from '../utils/generationContext';
import { GenerationJobEngine } from './engine';

let root: string;
let repository: ProjectRepository;
let engine: GenerationJobEngine;
let id: string;
const invoke = vi.fn();
let settings = { ...DEFAULT_SETTINGS };
const notified: Project[] = [];
beforeEach(async () => {
  settings = { ...DEFAULT_SETTINGS };
  notified.length = 0;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-jobs-'));
  repository = new ProjectRepository(root);
  const project = createNewProject('Test production', '');
  project.article = {
    title: 'Test source',
    bodyText: 'A small source for job orchestration tests.',
    importedImages: [],
  };
  const created = await repository.create(project);
  id = created.id;
  engine = new GenerationJobEngine(
    repository,
    invoke,
    async () => settings,
    (project) => notified.push(project)
  );
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    const now = new Date().toISOString();
    if (name === 'ai:generateScript') {
      const count = (args[1] as { targetPartCount: number }).targetPartCount;
      const parts = Array.from({ length: count }, (_, index) => {
        const part = createNewPart(index);
        part.scriptText = `Short narration ${index + 1}`;
        return part;
      });
      return { parts, usage: { model: 'gpt-5.2', inputTokens: 10, outputTokens: 10 } };
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
      const filePath = path.join(created.path, 'images', `${prompt.id}.png`);
      await fs.writeFile(filePath, 'test fixture');
      return {
        id: crypto.randomUUID(),
        filePath,
        sourceType: 'generated',
        metadata: {
          width: 1280,
          height: 720,
          mimeType: 'image/png',
          fileSize: 12,
          createdAt: now,
          promptId: prompt.id,
          tags: [],
          generation: {
            model: settings.imageModel,
            resolution: 'fhd',
            imageSizeTier: '1K',
            aspectRatio: '16:9',
            inputTokens: 10,
            outputTokens: 10,
          },
        },
      };
    }
    if (name === 'tts:generate') {
      const filePath = path.join(created.path, 'audio', `${crypto.randomUUID()}.wav`);
      await fs.writeFile(filePath, 'test fixture');
      return {
        audio: {
          id: crypto.randomUUID(),
          filePath,
          durationSec: 1,
          ttsEngine: settings.ttsEngine,
          voiceId: 'test',
          settings: { speakingRate: 1, pitch: 0, languageCode: 'ja-JP' },
          generatedAt: now,
        },
        usage: { model: settings.ttsModel, inputTokens: 10, outputTokens: 10 },
      };
    }
    if (name === 'video:render') {
      const outputPath = args[2] as string;
      await fs.writeFile(outputPath, 'mock export');
      return { outputPath };
    }
    throw new Error(`Unexpected operation: ${name}`);
  });
});
afterEach(async () => {
  vi.clearAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('persists every stage and completes independently of renderer callbacks', async () => {
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.job).toMatchObject({ status: 'completed', unknownCharges: 0 });
  const steps = saved.job!.outputs.map((output) => output.step);
  const partId = saved.parts[0].id;
  // 画像と音声は並列に進むので、順序は「台本が最初・プロンプトの後に画像・動画が最後」だけを確かめる
  expect([...steps].sort()).toEqual(
    ['script', `prompt:${partId}`, `image:${partId}`, `audio:${partId}`, 'video'].sort()
  );
  expect(steps[0]).toBe('script');
  expect(steps.at(-1)).toBe('video');
  expect(steps.indexOf(`prompt:${partId}`)).toBeLessThan(steps.indexOf(`image:${partId}`));
  expect(saved.job!.pendingOperations).toBeUndefined();
  expect(saved.usage).toHaveLength(4);
  expect(saved.usage.every((record) => record.jobId === saved.job!.id)).toBe(true);
});

// M5: 生成中に出す「見込み」と、映像のビットレートの自動決定
it('records the expected total at the start and renders with the automatic bitrate', async () => {
  const { estimateProjectGeneration } = await import('../../shared/project/generationEstimate');
  settings = { ...DEFAULT_SETTINGS, videoResolution: '3840x2160', videoFps: 60 };
  const before = await repository.load(id);
  const expected = estimateProjectGeneration(before, settings, 2).usd;
  await engine.start(id, { mode: 'automatic', targetPartCount: 2 });
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.job!.estimatedTotalUsd).toBeCloseTo(expected, 10);
  expect(saved.job!.estimatedTotalUsd).toBeGreaterThan(0);
  expect(saved.outputSettings).toMatchObject({
    resolution: '3840x2160',
    fps: 60,
    videoBitrate: '60M',
  });
  // 新しい動画の既定値と為替レートは、この動画の生成設定に入れない
  expect(saved.generationConfig).not.toHaveProperty('newProjectDefaults');
  expect(saved.generationConfig).not.toHaveProperty('jpyPerUsd');
});

it('keeps a bitrate that the user chose explicitly', async () => {
  settings = { ...DEFAULT_SETTINGS, videoBitrateMode: 'manual', videoBitrate: '6M' };
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  expect((await repository.load(id)).outputSettings?.videoBitrate).toBe('6M');
});

it('keeps a successful image when cancellation races the request and resumes without charging for it again', async () => {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    const result = await original(name, ...args);
    if (name === 'image:generate') await engine.cancel(id);
    return result;
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  expect((await repository.load(id)).job?.status).toBe('cancelled');
  expect((await repository.load(id)).images).toHaveLength(1);
  invoke.mockImplementation(original);
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  expect((await repository.load(id)).job?.status).toBe('completed');
  expect(invoke.mock.calls.filter(([name]) => name === 'image:generate')).toHaveLength(1);
});

it('stops at a review checkpoint and resumes only after the explicit start action', async () => {
  await engine.start(id, { mode: 'review', targetPartCount: 1 });
  await engine.wait(id);
  expect((await repository.load(id)).job).toMatchObject({ status: 'paused', stage: '台本の確認' });
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(['ai:generateScript']);
  await engine.start(id, { mode: 'review', targetPartCount: 1 });
  await engine.wait(id);
  expect((await repository.load(id)).job).toMatchObject({
    status: 'paused',
    stage: '素材と公開内容の確認',
  });
  await engine.start(id, { mode: 'review', targetPartCount: 1 });
  await engine.wait(id);
  expect((await repository.load(id)).job?.status).toBe('completed');
});

it('pauses before spending beyond the planning budget', async () => {
  await engine.start(id, { mode: 'automatic', targetPartCount: 1, budgetUsd: 0 });
  await engine.wait(id);
  expect((await repository.load(id)).job).toMatchObject({ status: 'paused', stage: '予算確認' });
  expect(invoke).not.toHaveBeenCalled();
});

it('does not stop at the budget check just because a charge could not be confirmed', async () => {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    const result = await original(name, ...args);
    if (name !== 'image:generate') return result;
    // 料金未確定: 使用量が返らなかった画像(このあとに音声のリクエストが続く)
    const generation = { ...result.metadata.generation };
    delete generation.inputTokens;
    delete generation.outputTokens;
    return { ...result, metadata: { ...result.metadata, generation } };
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 1, budgetUsd: 5 });
  await engine.wait(id);
  const job = (await repository.load(id)).job!;
  expect(job).toMatchObject({ status: 'completed', unknownCharges: 1 });
  expect(job.stage).not.toBe('予算確認');
});

it('recognizes interrupted jobs after a process restart without automatically repeating paid requests', async () => {
  await engine.start(id, { mode: 'review', targetPartCount: 1 });
  await engine.wait(id);
  await repository.update(id, (project) => {
    project.job!.status = 'running';
  });
  const restarted = new GenerationJobEngine(
    repository,
    invoke,
    async () => settings,
    () => {}
  );
  await restarted.recover();
  expect((await repository.load(id)).job?.status).toBe('interrupted');
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('retains previous paid outputs when a new generation replaces a completed job', async () => {
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  const previous = (await repository.load(id)).job!;
  await engine.start(id, { mode: 'review', targetPartCount: 1, restart: true });
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.job!.id).not.toBe(previous.id);
  expect(saved.jobHistory).toEqual([previous]);
  expect(saved.jobHistory![0].outputs).toHaveLength(5);
});

it('preserves paid output and newer edits when inputs change during an image request', async () => {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    const result = await original(name, ...args);
    if (name === 'image:generate')
      await repository.update(id, (project) => {
        project.parts[0].scriptText = 'New editorial text';
      });
    return result;
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.parts[0].scriptText).toBe('New editorial text');
  expect(saved.job!.status).toBe('failed');
  expect(saved.job!.outputs.some((output) => output.step.startsWith('image:'))).toBe(true);
  // 台本・プロンプト・(並列に完了した)音声・画像の 4 件はすべて料金として記録する
  expect(saved.usage.map((record) => record.operation).sort()).toEqual(
    ['image_generate', 'image_prompt_generate', 'script_generate', 'tts_generate'].sort()
  );
  // 入力が変わった画像は、パートには割り当てない(ジョブ履歴にだけ残す)
  expect(saved.parts[0].panelImages).toEqual([]);
});

// ---- 並列実行 ----

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const calls = (name: string) => invoke.mock.calls.filter(([called]) => called === name).length;

/** 指定した操作を、テストが解放するまで止める */
function holdOperations(names: string[]) {
  const original = invoke.getMockImplementation()!;
  const held: Array<{ name: string; release: () => void }> = [];
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (names.includes(name)) {
      const gate = deferred();
      held.push({ name, release: () => gate.resolve() });
      await gate.promise;
    }
    return original(name, ...args);
  });
  return {
    held,
    original,
    release: () => held.forEach((item) => item.release()),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it('starts speech together with the image prompts and sends the other Claude prompts after the first response begins', async () => {
  const original = invoke.getMockImplementation()!;
  const prompts: Array<{ release: () => void; onResponseStart?: () => void }> = [];
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'ai:generateImagePromptForTarget') {
      const gate = deferred();
      prompts.push({
        release: () => gate.resolve(),
        onResponseStart: jobOperationContext.getStore()?.onResponseStart,
      });
      await gate.promise;
    }
    return original(name, ...args);
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await vi.waitFor(() => expect(calls('tts:generate')).toBe(3));
  await vi.waitFor(() => expect(prompts).toHaveLength(1));
  // 1 本目の応答が始まるまでは、同じ記事への残りのプロンプトを送らない
  await wait(30);
  expect(prompts).toHaveLength(1);
  expect(prompts[0].onResponseStart).toBeTypeOf('function');
  prompts[0].onResponseStart!();
  await vi.waitFor(() => expect(prompts).toHaveLength(3));
  expect(prompts.slice(1).every((prompt) => prompt.onResponseStart === undefined)).toBe(true);
  // プロンプトができたパートから画像に進む(ほかのプロンプトの完了を待たない)
  prompts[0].release();
  await vi.waitFor(() => expect(calls('image:generate')).toBe(1));
  prompts.slice(1).forEach((prompt) => prompt.release());
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.job?.status).toBe('completed');
  expect(calls('image:generate')).toBe(3);
  expect(saved.parts.every((part) => partFreshness(saved, part).image === 'current')).toBe(true);
  expect(saved.parts.every((part) => partFreshness(saved, part).audio === 'current')).toBe(true);
});

it('sends every image prompt at once when the prompt model is not Claude', async () => {
  settings = { ...settings, imagePromptTextModel: 'gpt-5.6-sol' };
  const hold = holdOperations(['ai:generateImagePromptForTarget']);
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await vi.waitFor(() => expect(hold.held).toHaveLength(3));
  hold.release();
  await engine.wait(id);
  expect((await repository.load(id)).job?.status).toBe('completed');
});

it('keeps each kind of request within its concurrency limit', async () => {
  // 画像プロンプトを一斉に送る設定にして、プロンプト・画像・音声の同時実行数を順に確かめる
  settings = { ...settings, imagePromptTextModel: 'gpt-5.6-sol' };
  const original = invoke.getMockImplementation()!;
  const kinds: Record<string, 'prompt' | 'image' | 'audio'> = {
    'ai:generateImagePromptForTarget': 'prompt',
    'image:generate': 'image',
    'tts:generate': 'audio',
  };
  const running = { prompt: 0, image: 0, audio: 0 };
  const peak = { prompt: 0, image: 0, audio: 0 };
  const held: Record<'prompt' | 'image' | 'audio', Array<() => void>> = {
    prompt: [],
    image: [],
    audio: [],
  };
  let holding = true;
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    const kind = kinds[name];
    if (!kind) return original(name, ...args);
    running[kind]++;
    peak[kind] = Math.max(peak[kind], running[kind]);
    try {
      if (holding) {
        const gate = deferred();
        held[kind].push(() => gate.resolve());
        await gate.promise;
      }
      return await original(name, ...args);
    } finally {
      running[kind]--;
    }
  });
  const releaseAll = (kind: 'prompt' | 'image' | 'audio') =>
    held[kind].splice(0).forEach((release) => release());

  await engine.start(id, { mode: 'automatic', targetPartCount: 8 });
  await vi.waitFor(() => expect(running).toMatchObject({ prompt: 4, audio: 4 }));
  await wait(50);
  expect(running).toEqual({ prompt: 4, image: 0, audio: 4 });
  // プロンプトができたパートから画像に進むが、画像は 3 件まで
  releaseAll('prompt');
  await vi.waitFor(() => expect(running.image).toBe(3));
  await vi.waitFor(() => expect(running.prompt).toBe(4));
  await wait(50);
  expect(running.image).toBe(3);
  holding = false;
  for (const kind of ['prompt', 'audio', 'image'] as const) releaseAll(kind);
  await vi.waitFor(() => expect(Object.values(held).every((list) => list.length === 0)).toBe(true));
  await engine.wait(id);
  expect((await repository.load(id)).job?.status).toBe('completed');
  expect(peak).toEqual({ prompt: 4, image: 3, audio: 4 });
  expect(calls('image:generate')).toBe(8);
  expect(calls('tts:generate')).toBe(8);
});

it('starts nothing new after one request fails but saves the requests that were already running', async () => {
  const original = invoke.getMockImplementation()!;
  const release = deferred();
  const allStarted = deferred();
  let audioCalls = 0;
  const prompts: Array<() => void> = [];
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'tts:generate') {
      audioCalls++;
      if (audioCalls === 3) allStarted.resolve();
      // 3 件とも送った後で 2 件目が失敗する(1 件目と 3 件目は実行中)
      if (audioCalls === 2) {
        await allStarted.promise;
        throw new Error('音声の生成に失敗しました (invalid request)');
      }
      await release.promise;
    }
    if (name === 'ai:generateImagePromptForTarget') {
      const gate = deferred();
      prompts.push(() => gate.resolve());
      await gate.promise;
    }
    return original(name, ...args);
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await vi.waitFor(() => expect(audioCalls).toBe(3));
  // 2 件目の失敗の後に、実行中の 2 件を完了させる
  await wait(50);
  release.resolve();
  prompts.forEach((resolve) => resolve());
  await engine.wait(id);
  const failed = await repository.load(id);
  expect(failed.job).toMatchObject({ status: 'failed', error: { kind: 'invalid_input' } });
  expect(failed.job!.pendingOperations).toBeUndefined();
  // 実行中だった 2 件の音声は保存し、失敗の後は画像プロンプト(予約の保存を待っていたもの)も画像も始めない
  expect(failed.parts.filter((part) => part.audio)).toHaveLength(2);
  expect(prompts).toHaveLength(0);
  expect(failed.prompts).toHaveLength(0);
  expect(calls('image:generate')).toBe(0);

  invoke.mockImplementation(original);
  invoke.mockClear();
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await engine.wait(id);
  expect((await repository.load(id)).job?.status).toBe('completed');
  // 再開では、保存済みの素材を作り直さない
  expect(calls('tts:generate')).toBe(1);
  expect(calls('ai:generateImagePromptForTarget')).toBe(3);
  expect(calls('image:generate')).toBe(3);
});

it('does not send requests that were still waiting for their reservation to be saved when one fails', async () => {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'tts:generate') throw new Error('音声の生成に失敗しました (invalid request)');
    return original(name, ...args);
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await engine.wait(id);
  const failed = await repository.load(id);
  expect(failed.job?.status).toBe('failed');
  // 1 件目の失敗の後は、予約の保存を待っていた 2 件目以降も送らない
  expect(calls('tts:generate')).toBe(1);
  expect(calls('image:generate')).toBe(0);
  expect(failed.job!.pendingOperations).toBeUndefined();
  expect(failed.metrics?.generationRequests).toBeGreaterThanOrEqual(2);
});

it('does not send a request whose reservation was being saved when the job was stopped', async () => {
  const update = repository.update.bind(repository);
  const reserved = deferred();
  const resume = deferred();
  let held = false;
  repository.update = async (projectId, mutate) => {
    const saved = await update(projectId, mutate);
    if (!held && saved.job?.pendingOperations?.some((item) => item.step.startsWith('audio:'))) {
      held = true;
      reserved.resolve();
      await resume.promise;
    }
    return saved;
  };
  const hold = holdOperations(['ai:generateImagePromptForTarget']);
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await reserved.promise;
  await engine.cancel(id);
  resume.resolve();
  hold.release();
  await engine.wait(id);
  const cancelled = await repository.load(id);
  expect(cancelled.job?.status).toBe('cancelled');
  expect(calls('tts:generate')).toBe(0);
  expect(cancelled.job!.pendingOperations).toBeUndefined();
  expect(cancelled.job!.unknownCharges).toBe(0);
});

it('counts a request whose result could not be saved as an unconfirmed charge even when the job was stopped', async () => {
  const update = repository.update.bind(repository);
  const hold = holdOperations(['tts:generate']);
  let failNextResult = false;
  repository.update = async (projectId, mutate) => {
    if (failNextResult) {
      failNextResult = false;
      throw new Error('ENOSPC: no space left on device');
    }
    return update(projectId, mutate);
  };
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await vi.waitFor(() => expect(hold.held).toHaveLength(1));
  await engine.cancel(id);
  // 音声の結果の保存だけが失敗する(送信済みなので料金が発生したか分からない)
  failNextResult = true;
  hold.release();
  await engine.wait(id);
  const cancelled = await repository.load(id);
  expect(cancelled.job?.status).toBe('cancelled');
  expect(cancelled.job!.pendingOperations).toBeUndefined();
  expect(cancelled.job!.unknownCharges).toBeGreaterThanOrEqual(1);
});

it('lets running requests finish and save when stopped in the middle of the parallel stage', async () => {
  const hold = holdOperations(['tts:generate', 'ai:generateImagePromptForTarget']);
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await vi.waitFor(() => expect(hold.held).toHaveLength(4));
  await engine.cancel(id);
  hold.release();
  await engine.wait(id);
  const cancelled = await repository.load(id);
  expect(cancelled.job?.status).toBe('cancelled');
  expect(cancelled.parts.filter((part) => part.audio)).toHaveLength(3);
  expect(cancelled.prompts).toHaveLength(1);
  expect(calls('image:generate')).toBe(0);
  expect(calls('ai:generateImagePromptForTarget')).toBe(1);
  expect(cancelled.job!.pendingOperations).toBeUndefined();

  invoke.mockImplementation(hold.original);
  invoke.mockClear();
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await engine.wait(id);
  expect((await repository.load(id)).job?.status).toBe('completed');
  expect(calls('tts:generate')).toBe(0);
  expect(calls('ai:generateImagePromptForTarget')).toBe(2);
});

it('reserves the estimate of running requests before checking the budget and pauses without a revision conflict', async () => {
  const { BUDGET_RESERVE_MULTIPLIER, estimateGenerationUsd } =
    await import('../../shared/project/generationEstimate');
  await engine.start(id, { mode: 'review', targetPartCount: 3 });
  await engine.wait(id);
  const reviewed = await repository.load(id);
  expect(reviewed.job).toMatchObject({ status: 'paused', stage: '台本の確認' });
  const audioAllowance =
    estimateGenerationUsd('audio', reviewed.parts[0].scriptText, settings) *
    BUDGET_RESERVE_MULTIPLIER;
  // 2 件分の音声は予約できるが、3 件目は予約すると予算を超える
  const budgetUsd = reviewed.job!.spentUsd + audioAllowance * 2.5;
  const hold = holdOperations(['tts:generate']);
  await engine.start(id, { mode: 'automatic', targetPartCount: 3, budgetUsd });
  await vi.waitFor(() => expect(hold.held).toHaveLength(2));
  await wait(30);
  expect(hold.held).toHaveLength(2);
  hold.release();
  await engine.wait(id);
  const paused = await repository.load(id);
  expect(paused.job).toMatchObject({ status: 'paused', stage: '予算確認' });
  expect(paused.job!.estimatedRemainingUsd).toBeCloseTo(audioAllowance, 6);
  expect(paused.job!.pendingOperations).toBeUndefined();
  expect(paused.parts.filter((part) => part.audio)).toHaveLength(2);
  expect(calls('ai:generateImagePromptForTarget')).toBe(0);
});

it('counts every running request as an unconfirmed charge after a restart, including the old single record', async () => {
  await engine.start(id, { mode: 'review', targetPartCount: 1 });
  await engine.wait(id);
  await repository.update(id, (project) => {
    project.job!.status = 'running';
    project.job!.pendingOperation = { step: 'image:legacy', kind: 'image', estimatedUsd: 0.2 };
    project.job!.pendingOperations = [
      { step: 'prompt:a', kind: 'prompt', estimatedUsd: 0.01 },
      { step: 'audio:b', kind: 'audio', estimatedUsd: 0.01 },
    ];
  });
  const restarted = new GenerationJobEngine(
    repository,
    invoke,
    async () => settings,
    () => {}
  );
  await restarted.recover();
  const job = (await repository.load(id)).job!;
  expect(job.status).toBe('interrupted');
  expect(job.unknownCharges).toBe(3);
  expect(job.pendingOperation).toBeUndefined();
  expect(job.pendingOperations).toBeUndefined();
});

it('reports per-step progress through job:statusChange while the job runs', async () => {
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.job!.progress).toMatchObject({
    script: { done: 1, total: 1 },
    prompt: { done: 3, total: 3 },
    image: { done: 3, total: 3 },
    audio: { done: 3, total: 3 },
    video: { percent: 100 },
  });
  const seen = (kind: 'image' | 'audio') =>
    new Set(
      notified
        .map((project) => project.job?.progress?.[kind])
        .filter(Boolean)
        .map((progress) => `${progress!.done}/${progress!.total}`)
    );
  expect(seen('image')).toEqual(new Set(['0/3', '1/3', '2/3', '3/3']));
  expect(seen('audio')).toEqual(new Set(['0/3', '1/3', '2/3', '3/3']));
});

it('thins out video progress saves and shows the final state', async () => {
  engine = new GenerationJobEngine(
    repository,
    invoke,
    async () => settings,
    (project) => notified.push(project),
    { videoProgressIntervalMs: 60_000 }
  );
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'video:render') {
      const context = jobOperationContext.getStore();
      for (let percent = 1; percent < 100; percent++) {
        context?.onRenderProgress?.({ percent, message: `書き出し中 ${percent}%` });
        await wait(1);
      }
    }
    return original(name, ...args);
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  const videoSaves = notified
    .map((project) => project.job?.progress?.video?.percent)
    .filter((percent): percent is number => percent !== undefined && percent > 0 && percent < 100);
  expect(videoSaves.length).toBeGreaterThanOrEqual(5);
  expect(videoSaves.length).toBeLessThanOrEqual(21);
  expect((await repository.load(id)).job!.progress!.video).toMatchObject({ percent: 100 });
});

it('keeps the last video progress when the export is stopped between saves', async () => {
  engine = new GenerationJobEngine(
    repository,
    invoke,
    async () => settings,
    (project) => notified.push(project),
    { videoProgressIntervalMs: 60_000 }
  );
  const original = invoke.getMockImplementation()!;
  let reported = false;
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'video:render') {
      const context = jobOperationContext.getStore()!;
      context.onRenderProgress?.({ percent: 50, message: 'シーン 1 / 1 を書き出し中' });
      await wait(20);
      // 5% 未満の前進で、間隔もあいていないので、この値はすぐには保存されない
      context.onRenderProgress?.({ percent: 53, message: 'シーン 1 / 1 を書き出し中' });
      reported = true;
      await new Promise((_, reject) =>
        context.signal?.addEventListener('abort', () => reject(new Error('キャンセルしました')))
      );
    }
    return original(name, ...args);
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await vi.waitFor(() => expect(reported).toBe(true));
  await engine.cancel(id);
  await engine.wait(id);
  const cancelled = await repository.load(id);
  expect(cancelled.job?.status).toBe('cancelled');
  expect(cancelled.job!.progress!.video).toMatchObject({ percent: 53 });
});

it('stops the running export when the job is cancelled', async () => {
  const original = invoke.getMockImplementation()!;
  let rendering = false;
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'video:render') {
      const signal = jobOperationContext.getStore()?.signal;
      rendering = true;
      await new Promise((_, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('キャンセルしました')))
      );
    }
    return original(name, ...args);
  });
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await vi.waitFor(() => expect(rendering).toBe(true));
  await engine.cancel(id);
  await engine.wait(id);
  expect((await repository.load(id)).job).toMatchObject({
    status: 'cancelled',
    error: { kind: 'cancelled' },
  });
});

it('keeps per-part results consistent when another part is edited during parallel image requests', async () => {
  const hold = holdOperations(['image:generate']);
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await vi.waitFor(() => expect(hold.held).toHaveLength(3));
  const before = await repository.load(id);
  const edited = before.parts[1].id;
  await repository.update(id, (project) => {
    project.parts.find((part) => part.id === edited)!.scriptText = 'Edited while generating';
  });
  hold.release();
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.job?.status).toBe('failed');
  expect(saved.job?.error?.message).toContain('入力が変更されました');
  expect(saved.parts.find((part) => part.id === edited)!.scriptText).toBe(
    'Edited while generating'
  );
  // 編集していないパートの結果は失われずに割り当てられ、最新のまま
  for (const part of saved.parts.filter((item) => item.id !== edited)) {
    expect(part.panelImages).toHaveLength(1);
    expect(partFreshness(saved, part)).toMatchObject({ image: 'current', audio: 'current' });
  }
  // 編集したパートの画像は割り当てず、ジョブ履歴にだけ残す
  expect(saved.parts.find((part) => part.id === edited)!.panelImages).toEqual([]);
  expect(saved.job!.outputs.filter((output) => output.step.startsWith('image:'))).toHaveLength(3);
  expect(saved.images).toHaveLength(2);

  invoke.mockImplementation(hold.original);
  invoke.mockClear();
  await engine.start(id, { mode: 'automatic', targetPartCount: 3 });
  await engine.wait(id);
  expect((await repository.load(id)).job?.status).toBe('completed');
  expect(calls('image:generate')).toBe(1);
  expect(calls('tts:generate')).toBe(1);
  expect(calls('ai:generateImagePromptForTarget')).toBe(1);
});

it('keeps a paid result in the job history when its scene is deleted during the request', async () => {
  const hold = holdOperations(['image:generate']);
  await engine.start(id, { mode: 'automatic', targetPartCount: 2 });
  await vi.waitFor(() => expect(hold.held).toHaveLength(2));
  const removed = (await repository.load(id)).parts[0].id;
  await repository.update(id, (project) => {
    project.parts = project.parts.filter((part) => part.id !== removed);
  });
  hold.release();
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.job?.status).toBe('failed');
  expect(saved.job?.error?.message).toContain('入力が変更されました');
  expect(saved.job!.outputs.some((output) => output.step === `image:${removed}`)).toBe(true);
  expect(saved.job!.pendingOperations).toBeUndefined();
  expect(saved.usage.filter((record) => record.operation === 'image_generate')).toHaveLength(2);
});

it('replaces only the first image of a scene that has several images when regenerating it', async () => {
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  const first = await repository.load(id);
  const lead = first.parts[0].panelImages[0];
  expect(first.parts[0].panelImages).toHaveLength(1);
  // 利用者が 2 枚目を足し、先頭の表示時間を決めたあとで台本を直す(画像が古くなる)
  const extraPath = path.join(first.path, 'images', 'extra.png');
  await fs.writeFile(extraPath, 'extra');
  const extra = {
    ...first.images[0],
    id: crypto.randomUUID(),
    filePath: extraPath,
  };
  await repository.update(id, (project) => {
    project.images.push(extra);
    project.parts[0].panelImages = [
      { imageId: lead.imageId, displayDurationSec: 2 },
      { imageId: extra.id },
    ];
  });
  await repository.update(id, (project) => {
    project.parts[0].scriptText = 'Rewritten narration';
  });
  expect(partFreshness(await repository.load(id), (await repository.load(id)).parts[0]).image).toBe(
    'stale'
  );
  invoke.mockClear();
  await engine.start(id, { mode: 'automatic', targetPartCount: 1 });
  await engine.wait(id);
  const saved = await repository.load(id);
  expect(saved.job?.status).toBe('completed');
  expect(calls('image:generate')).toBe(1);
  const [newLead, kept] = saved.parts[0].panelImages;
  expect(saved.parts[0].panelImages).toHaveLength(2);
  expect(newLead.imageId).not.toBe(lead.imageId);
  expect(newLead.displayDurationSec).toBe(2);
  expect(kept).toEqual({ imageId: extra.id });
  expect(partFreshness(saved, saved.parts[0]).image).toBe('current');
});
