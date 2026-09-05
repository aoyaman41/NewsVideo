import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileAccessPolicy } from './fileAccess';
vi.mock('electron', () => ({ app: {} }));
let root: string; let policy: FileAccessPolicy;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-access-')); await fs.mkdir(path.join(root, 'projects')); policy = new FileAccessPolicy([path.join(root, 'projects')], path.join(root, 'grants.json')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('rejects traversal, sibling prefixes and symlink escapes', async () => {
  const secret = path.join(root, 'secret.enc'); await fs.writeFile(secret, 'not a key');
  await fs.symlink(secret, path.join(root, 'projects', 'image.png'));
  await expect(policy.assert(path.join(root, 'projects', '..', 'secret.enc'))).rejects.toThrow('許可');
  await expect(policy.assert(path.join(root, 'projects-other', 'file.png'))).rejects.toThrow('許可');
  await expect(policy.media(path.join(root, 'projects', 'image.png'))).rejects.toThrow('許可');
});

it('persists exact read grants but never upgrades them to writes or whole directories', async () => {
  const input = path.join(root, 'input.png'); await fs.writeFile(input, 'fixture');
  await policy.grant(input, false);
  const restarted = new FileAccessPolicy([path.join(root, 'projects')], path.join(root, 'grants.json'));
  expect(await restarted.media(input)).toBe(await fs.realpath(input));
  await expect(restarted.media(input, true)).rejects.toThrow('許可');
  await expect(restarted.assert(path.join(root, 'another.png'))).rejects.toThrow('許可');
  await expect(restarted.media(path.join(root, 'projects', 'project.json'))).rejects.toThrow('形式');
});

it('allows output creation only inside the selected directory', async () => {
  const output = path.join(root, 'exports'); await fs.mkdir(output);
  await policy.grant(output, true, true);
  expect(await policy.media(path.join(output, 'final.mp4'), true)).toBe(path.join(await fs.realpath(output), 'final.mp4'));
  await expect(policy.media(path.join(root, 'final.mp4'), true)).rejects.toThrow('許可');
});
