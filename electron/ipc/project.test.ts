import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Project } from '../../shared/project/schema';
import { DEFAULT_NEW_PROJECT_DEFAULTS, DEFAULT_SETTINGS } from '../../shared/settings/appSettings';

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = vi.hoisted(() => new Map<string, IpcHandler>());
const paths = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
    getPath: () => paths.userData,
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  nativeImage: {},
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
  },
}));

const event = { senderFrame: { url: 'http://localhost:5173', parent: null } };
const call = <T>(channel: string, ...args: unknown[]) =>
  handlers.get(channel)!(event, ...args) as Promise<T>;

beforeEach(async () => {
  paths.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-project-ipc-'));
  handlers.clear();
  vi.resetModules();
  await import('./project');
});
afterEach(async () => {
  await fs.rm(paths.userData, { recursive: true, force: true });
});

async function writeSettings(value: unknown) {
  await fs.writeFile(path.join(paths.userData, 'settings.json'), JSON.stringify(value));
}

// M5: 新しい動画は、用途の値に「新しい動画」の既定値を重ねて作る
describe('project:create', () => {
  it('starts a video with its purpose when no settings exist yet', async () => {
    const created = await call<Project>('project:create', { name: '新しい動画', purpose: 'short' });
    expect(created.generationConfig).toEqual({ targetPartCount: 5 });
    expect(created.presentationProfile).toMatchObject({
      preset: 'short',
      aspectRatio: '9:16',
      targetDurationPerPartSec: 12,
      ttsNarrationStylePreset: 'casual',
      sourceDisplayMode: 'hidden',
    });
  });

  it('applies the new video defaults but keeps the aspect ratio, length and scene count of the purpose', async () => {
    await writeSettings({
      ...DEFAULT_SETTINGS,
      defaultAspectRatio: '1:1',
      newProjectDefaults: {
        ...DEFAULT_NEW_PROJECT_DEFAULTS,
        imageStylePreset: 'editorial',
        ttsNarrationStylePreset: 'promo',
        closingCardHeadline: 'ご覧いただきありがとうございました',
        sourceDisplayMode: 'auto',
      },
    });
    const created = await call<Project>('project:create', {
      name: '新しい動画',
      purpose: 'explain',
    });
    expect(created.generationConfig).toEqual({ targetPartCount: 6 });
    expect(created.presentationProfile).toMatchObject({
      preset: 'explain',
      aspectRatio: '16:9',
      targetDurationPerPartSec: 30,
      imageStylePreset: 'editorial',
      ttsNarrationStylePreset: 'promo',
      closingCardHeadline: 'ご覧いただきありがとうございました',
      sourceDisplayMode: 'auto',
    });
  });

  it('uses the old aspect ratio setting only for a creation without a purpose', async () => {
    await writeSettings({ ...DEFAULT_SETTINGS, defaultAspectRatio: '1:1' });
    const created = await call<Project>('project:create', '旧形式');
    expect(created.presentationProfile.aspectRatio).toBe('1:1');
  });
});

describe('project:applyNewProjectDefaults', () => {
  it('updates only videos without a script, and counts them in a dry run', async () => {
    const draft = await call<Project>('project:create', { name: '台本なし', purpose: 'news' });
    const withScript = await call<Project>('project:create', { name: '台本あり', purpose: 'news' });
    const { getProjectRepository } = await import('./project');
    const { createNewPart } = await import('../../shared/project/schema');
    await getProjectRepository().update(withScript.id, (project) => {
      project.parts = [createNewPart(0, { scriptText: '台本' })];
    });
    const defaults = { ...DEFAULT_NEW_PROJECT_DEFAULTS, imageStylePreset: 'dataCard' as const };

    await expect(
      call('project:applyNewProjectDefaults', { defaults, dryRun: true })
    ).resolves.toEqual({ count: 1 });
    expect((await getProjectRepository().load(draft.id)).presentationProfile.imageStylePreset).toBe(
      'infographic'
    );

    await expect(call('project:applyNewProjectDefaults', { defaults })).resolves.toEqual({
      count: 1,
    });
    expect((await getProjectRepository().load(draft.id)).presentationProfile.imageStylePreset).toBe(
      'dataCard'
    );
    expect(
      (await getProjectRepository().load(withScript.id)).presentationProfile.imageStylePreset
    ).toBe('infographic');
  });

  it('rejects invalid defaults', async () => {
    await expect(
      call('project:applyNewProjectDefaults', { defaults: { purpose: 'report' } })
    ).rejects.toThrow();
  });
});
