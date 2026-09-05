import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNewProject } from '../../shared/project/schema';
import { ProjectRepository } from './repository';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
let root: string;
let repository: ProjectRepository;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-repository-'));
  repository = new ProjectRepository(root);
});
afterEach(async () => {
  vi.mocked(fs.rename).mockRestore();
  await fs.rm(root, { recursive: true, force: true });
});

it('saves blank drafts as one manifest and ignores a renderer-supplied storage path', async () => {
  const created = await repository.create(createNewProject('Draft', ''));
  const saved = await repository.save({
    ...created,
    path: '/unauthorized',
    article: { ...created.article, bodyText: 'draft' },
  });
  expect(saved.path).toBe(created.path);
  expect((await repository.load(created.id)).article.bodyText).toBe('draft');
  expect(saved.revision).toBe(1);
});

it('serializes concurrent writers and rejects the stale revision without losing the winner', async () => {
  const created = await repository.create(createNewProject('Concurrent', ''));
  const results = await Promise.allSettled([
    repository.save({ ...created, name: 'winner' }),
    repository.save({ ...created, name: 'stale' }),
  ]);
  expect(results[0].status).toBe('fulfilled');
  expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
  expect((await repository.load(created.id)).name).toBe('winner');
});

it('keeps a complete old generation when the final rename fails', async () => {
  const created = await repository.create(createNewProject('Before', ''));
  const rename = fs.rename;
  vi.mocked(rename)
    .mockImplementationOnce(async (from, to) => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.rename(from, to);
    })
    .mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
  await expect(
    repository.save({
      ...created,
      name: 'After',
      article: { ...created.article, bodyText: 'new text' },
    })
  ).rejects.toThrow('disk full');
  const restarted = new ProjectRepository(root);
  expect(await restarted.load(created.id)).toMatchObject({
    name: 'Before',
    article: { bodyText: '' },
    revision: 0,
  });
});

it('recovers a corrupted commit from its complete backup and distinguishes unsupported versions', async () => {
  const created = await repository.create(createNewProject('Recovery', ''));
  await repository.save({ ...created, name: 'Next' });
  const file = path.join(created.path, 'project.json');
  await fs.writeFile(file, '{broken');
  expect((await repository.load(created.id)).name).toBe('Recovery');
  await fs.writeFile(file, JSON.stringify({ ...created, schemaVersion: 'v99.0' }));
  await expect(repository.load(created.id)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
  await fs.writeFile(file, '{broken');
  await fs.writeFile(path.join(created.path, 'project.previous.json'), '{broken');
  await expect(repository.load(created.id)).rejects.toMatchObject({ code: 'CORRUPT' });
  await expect(repository.load(crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('migrates a legacy project only when saved and retains a complete recoverable backup', async () => {
  const legacy = createNewProject('Legacy', '');
  const directory = path.join(root, `Legacy_${legacy.id.slice(0, 8)}.newsproj`);
  await fs.mkdir(directory);
  const { article, parts, images, prompts, audio, usage, ...meta } = legacy;
  for (const [name, value] of Object.entries({
    project: meta,
    article,
    parts,
    images,
    prompts,
    audio,
    usage,
  }))
    await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(value));
  const loaded = await repository.load(legacy.id);
  expect(loaded.schemaVersion).toBe('v1.2');
  await repository.save(loaded);
  expect((await repository.load(legacy.id)).schemaVersion).toBe('v2.0');
  await fs.writeFile(path.join(directory, 'project.json'), 'broken');
  expect((await repository.load(legacy.id)).article).toEqual(article);
});
