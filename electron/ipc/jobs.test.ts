/**
 * ジョブ履歴からの素材の復元(jobs:recoverAsset)。1 シーンに複数の画像を置けるため、復元した画像は
 * 先頭の枠だけに入れ、2 枚目以降は残す。
 */
import { afterAll, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';

// jobs.ts は読み込み時(app.whenReady の後)にリポジトリを作るので、読み込む前に一時フォルダを決めておく
const h = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { userData: mkdtempSync(join(tmpdir(), 'newsvideo-jobs-ipc-')) };
});

vi.mock('electron', () => ({
  ipcMain: { handle: () => {} },
  app: {
    getPath: () => h.userData,
    isPackaged: false,
    getAppPath: () => '/',
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock('../utils/fileAccess', () => ({
  fileAccess: () => ({ media: async (file: string) => file, grant: async () => {} }),
}));

import { invokeOperation } from './operations';
import { getProjectRepository } from './project';
import './jobs';
import { createNewPart, createNewProject, type ImageAsset } from '../../shared/project/schema';
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings';

afterAll(async () => {
  await fs.rm(h.userData, { recursive: true, force: true });
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
    },
  };
}

it('restores an image from the job history into the first slot and keeps the other images', async () => {
  const repo = getProjectRepository();
  const draft = createNewProject('Recover', '');
  draft.article = { title: 'Source', bodyText: 'Body.', importedImages: [] };
  const created = await repo.create(draft);
  const files = ['lead.png', 'second.png', 'restored.png'].map((name) =>
    path.join(created.path, 'images', name)
  );
  for (const file of files) await fs.writeFile(file, 'img');
  const [lead, second, restored] = files.map(imageAsset);
  const part = createNewPart(0, { title: 'P1', scriptText: 'Narration' });
  part.panelImages = [{ imageId: lead.id, displayDurationSec: 3 }, { imageId: second.id }];
  const now = new Date().toISOString();
  const project = await repo.update(created.id, (data) => {
    data.images = [lead, second];
    data.parts = [part];
    data.job = {
      id: crypto.randomUUID(),
      status: 'completed',
      stage: '完了',
      mode: 'automatic',
      targetPartCount: 1,
      startedAt: now,
      updatedAt: now,
      completed: [],
      outputs: [{ step: `image:${part.id}`, payload: restored, createdAt: now }],
      reviewedStages: [],
      cancelRequested: false,
      settings: { ...DEFAULT_SETTINGS },
      spentUsd: 0,
      estimatedRemainingUsd: 0,
      unknownCharges: 0,
    };
  });

  await invokeOperation('jobs:recoverAsset', {
    projectId: project.id,
    index: 0,
    jobId: project.job!.id,
    partId: part.id,
  });

  const saved = await repo.load(project.id);
  expect(saved.parts[0].panelImages).toEqual([
    { imageId: restored.id, displayDurationSec: 3 },
    { imageId: second.id },
  ]);
  expect(saved.images.map((image) => image.id)).toContain(restored.id);
});
