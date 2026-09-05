import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNewPart, createNewProject, type ImagePrompt } from '../../shared/project/schema';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';
import { ProjectRepository } from '../project/repository';
import { GenerationJobEngine } from './engine';

let root: string;
let repository: ProjectRepository;
let engine: GenerationJobEngine;
let id: string;
const invoke = vi.fn();
const settings = { ...DEFAULT_SETTINGS };
beforeEach(async () => {
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
    () => {}
  );
  invoke.mockImplementation(async (name: string, ...args: unknown[]) => {
    const now = new Date().toISOString();
    if (name === 'ai:generateScript') {
      const part = createNewPart(0);
      part.scriptText = 'Short narration';
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
      const filePath = path.join(created.path, 'audio', 'test.wav');
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
  expect(saved.job!.outputs.map((output) => output.step)).toEqual([
    'script',
    `prompt:${saved.parts[0].id}`,
    `image:${saved.parts[0].id}`,
    `audio:${saved.parts[0].id}`,
    'video',
  ]);
  expect(saved.usage).toHaveLength(4);
  expect(saved.usage.every((record) => record.jobId === saved.job!.id)).toBe(true);
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
