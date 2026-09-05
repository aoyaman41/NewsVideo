import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectRepository } from './repository';
import { ProjectLifecycle } from './lifecycle';
import { createNewProject } from '../../shared/project/schema';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nv-lifecycle-')); roots.push(root);
  const repo = new ProjectRepository(path.join(root, 'projects'));
  let project = await repo.create(createNewProject('sample', ''));
  const file = path.join(project.path, 'images', 'sample.png'); await fs.writeFile(file, 'fixture');
  project = await repo.update(project.id, (data) => { data.article.bodyText = 'keep draft'; data.article.importedImages.push({ id: crypto.randomUUID(), filePath: file, sourceType: 'imported', metadata: { width: 1, height: 1, fileSize: 7, mimeType: 'image/png', createdAt: new Date().toISOString(), tags: [] } }); });
  return { root, repo, project, lifecycle: new ProjectLifecycle(repo, async (file) => file) };
}
it('restores a portable backup after the original assets have been removed', async () => {
  const { root, project, lifecycle } = await setup();
  const backup = await lifecycle.export(project.id, root);
  await fs.rm(project.path, { recursive: true });
  const restored = await lifecycle.import(backup);
  expect(restored.id).not.toBe(project.id);
  expect(restored.article.bodyText).toBe('keep draft');
  expect(await fs.readFile(restored.article.importedImages[0].filePath, 'utf8')).toBe('fixture');
});
it('rejects traversal and symlinked backup assets', async () => {
  const { root, project, lifecycle } = await setup();
  const backup = await lifecycle.export(project.id, root);
  const manifestPath = path.join(backup, 'backup.json');
  const data = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  data.project.article.importedImages[0].filePath = '../outside.png';
  await fs.writeFile(manifestPath, JSON.stringify(data));
  await expect(lifecycle.import(backup)).rejects.toThrow('不正なパス');
  const outside = path.join(root, 'outside.png'); await fs.writeFile(outside, 'outside');
  await fs.symlink(outside, path.join(backup, 'evil.png'));
  data.project.article.importedImages[0].filePath = 'evil.png'; await fs.writeFile(manifestPath, JSON.stringify(data));
  await expect(lifecycle.import(backup)).rejects.toThrow('範囲外');
});
it('clones independent assets, saves clean templates, and restores trash', async () => {
  const { root, repo, project, lifecycle } = await setup();
  const clone = await lifecycle.clone(project.id);
  expect(clone.article.importedImages[0].filePath).not.toBe(project.article.importedImages[0].filePath);
  const template = await lifecycle.clone(project.id, true);
  expect(template.template).toBe(true); expect(template.article.importedImages).toEqual([]); expect(template.article.bodyText).toBe('');
  const key = `123-${path.basename(project.path)}`;
  await fs.mkdir(path.join(root, 'trash')); await fs.rename(project.path, path.join(root, 'trash', key));
  await lifecycle.restore(key);
  const restored = await repo.load(project.id);
  expect(restored.integrity?.missingFiles).toEqual([]);
});
