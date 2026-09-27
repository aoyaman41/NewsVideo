import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNewProject } from '../../shared/project/schema';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/newsvideo-ledger-service-test' } }));

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-ledger-scan-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// M5: 台帳の初回作成は、projects とごみ箱(trash)の全プロジェクトの usage から行う
it('reads the usage of every project, including the trash, and skips unreadable ones', async () => {
  const { ProjectRepository } = await import('../project/repository');
  const { scanProjectUsage } = await import('./ledgerService');
  const projects = path.join(root, 'projects');
  const trash = path.join(root, 'trash');
  const usage = {
    id: crypto.randomUUID(),
    provider: 'openai' as const,
    category: 'image' as const,
    model: 'gpt-image-2.5-sunburst',
    operation: 'image_generate',
    createdAt: '2026-09-26T00:00:00.000Z',
  };
  const active = createNewProject('残っている動画', '');
  active.usage = [usage];
  await new ProjectRepository(projects).create(active);
  const deleted = createNewProject('削除した動画', '');
  deleted.usage = [{ ...usage, id: crypto.randomUUID() }];
  const created = await new ProjectRepository(trash).create(deleted);
  // ごみ箱の中のフォルダ名は「時刻-元の名前」
  await fs.rename(created.path, path.join(trash, `1790000000000-${deleted.id}.newsproj`));
  await fs.mkdir(path.join(projects, 'broken.newsproj'));
  await fs.writeFile(path.join(projects, 'broken.newsproj', 'project.json'), '{broken');

  const sources = await scanProjectUsage([projects, trash, path.join(root, 'missing')]);
  expect(sources.map((source) => source.projectName).sort()).toEqual([
    '削除した動画',
    '残っている動画',
  ]);
  expect(sources.flatMap((source) => source.usage)).toHaveLength(2);
});
