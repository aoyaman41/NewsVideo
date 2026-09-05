import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNewProject, type Project } from '../schemas';
import { projectClient } from './projectStore';

const load = vi.fn();
const save = vi.fn();
beforeEach(() => {
  vi.stubGlobal('window', { electronAPI: { project: { load, save } } });
  save.mockImplementation(async (project: Project) => ({
    project: structuredClone({ ...project, revision: (project.revision ?? 0) + 1 }),
    revision: (project.revision ?? 0) + 1,
    savedAt: new Date().toISOString(),
    success: true,
  }));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('retains the entered draft after a failed write and retries without calling a generation API', async () => {
  const project = createNewProject('Draft', '/tmp/draft');
  load.mockResolvedValue(project);
  await projectClient.load(project.id);
  const edited = { ...project, article: { ...project.article, bodyText: 'unsubmitted draft' } };
  save.mockRejectedValueOnce(new Error('disk full'));
  await expect(projectClient.save(edited)).rejects.toThrow('disk full');
  expect((await projectClient.load(project.id)).article.bodyText).toBe('unsubmitted draft');
  await projectClient.flush(project.id);
  expect(save).toHaveBeenCalledTimes(2);
  expect(edited.revision).toBe(1);
});

it('keeps newer input while an earlier save is in flight', async () => {
  const project = createNewProject('Typing', '/tmp/typing');
  load.mockResolvedValue(project);
  await projectClient.load(project.id);
  let release!: (value: unknown) => void;
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const first = { ...project, name: 'First' };
  const second = { ...project, name: 'Second' };
  const a = projectClient.save(first);
  const b = projectClient.save(second);
  release({ project: { ...first, revision: 1 }, revision: 1, savedAt: new Date().toISOString() });
  await Promise.all([a, b]);
  expect((await projectClient.load(project.id)).name).toBe('Second');
  expect(save).toHaveBeenCalledTimes(2);
});
