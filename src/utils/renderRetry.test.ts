import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNewProject, type Project } from '../../shared/project/schema';
import { renderConflictMessage } from '../../shared/project/renderIntent';

const disk = new Map<string, Project>();
let holdSaves = false;
const heldSaves: Array<() => void> = [];

beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      project: {
        load: async (id: string) => structuredClone(disk.get(id)!),
        save: async (project: Project) => {
          if (holdSaves) await new Promise<void>((resolve) => heldSaves.push(resolve));
          const saved = {
            ...structuredClone(project),
            revision: (project.revision ?? 0) + 1,
            updatedAt: new Date().toISOString(),
          };
          disk.set(project.id, saved);
          return {
            success: true,
            savedAt: saved.updatedAt,
            revision: saved.revision,
            project: structuredClone(saved),
          };
        },
        onChanged: () => () => {},
      },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  holdSaves = false;
  heldSaves.splice(0).forEach((resolve) => resolve());
});

async function modules() {
  const { projectClient } = await import('../stores/projectStore');
  const { withRenderConflictRetry } = await import('./renderRetry');
  return { projectClient, withRenderConflictRetry };
}

function seed(name: string) {
  const project = { ...createNewProject(name, '/tmp/project'), revision: 0 };
  disk.set(project.id, structuredClone(project));
  return project;
}

const conflict = () =>
  new Error(
    `Error invoking remote method 'video:render': Error: ${renderConflictMessage('render')}`
  );

describe('withRenderConflictRetry', () => {
  it('reloads and retries exactly once after a content conflict', async () => {
    const { projectClient, withRenderConflictRetry } = await modules();
    const reload = vi.spyOn(projectClient, 'reloadIfClean').mockResolvedValue(true);
    const attempt = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce('ok');
    await expect(withRenderConflictRetry('id', attempt)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls).toEqual([[false], [true]]);
    expect(reload).toHaveBeenCalledWith('id');
  });

  it('does not retry a second time', async () => {
    const { projectClient, withRenderConflictRetry } = await modules();
    vi.spyOn(projectClient, 'reloadIfClean').mockResolvedValue(true);
    const attempt = vi.fn().mockRejectedValue(conflict());
    await expect(withRenderConflictRetry('id', attempt)).rejects.toThrow('[RENDER_CONFLICT]');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the screen has unsaved changes', async () => {
    const { projectClient, withRenderConflictRetry } = await modules();
    vi.spyOn(projectClient, 'reloadIfClean').mockResolvedValue(false);
    const attempt = vi.fn().mockRejectedValue(conflict());
    await expect(withRenderConflictRetry('id', attempt)).rejects.toThrow('[RENDER_CONFLICT]');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry other errors', async () => {
    const { projectClient, withRenderConflictRetry } = await modules();
    const reload = vi.spyOn(projectClient, 'reloadIfClean');
    const attempt = vi.fn().mockRejectedValue(new Error('出力先に動画を書き込めません'));
    await expect(withRenderConflictRetry('id', attempt)).rejects.toThrow('書き込めません');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('projectClient.reloadIfClean', () => {
  it('replaces a clean project with the saved latest', async () => {
    const { projectClient } = await modules();
    const project = seed('Clean');
    await projectClient.load(project.id);
    disk.set(project.id, { ...structuredClone(project), name: 'Changed on disk', revision: 3 });
    await expect(projectClient.reloadIfClean(project.id)).resolves.toBe(true);
    expect(await projectClient.load(project.id)).toMatchObject({
      name: 'Changed on disk',
      revision: 3,
    });
  });

  it('keeps the screen data while a save is still in flight', async () => {
    const { projectClient } = await modules();
    const project = seed('Dirty');
    const loaded = await projectClient.load(project.id);
    holdSaves = true;
    const saving = projectClient.save({ ...loaded, name: 'Unsaved edit' });
    disk.set(project.id, { ...structuredClone(project), name: 'Changed on disk', revision: 5 });
    await expect(projectClient.reloadIfClean(project.id)).resolves.toBe(false);
    expect((await projectClient.load(project.id)).name).toBe('Unsaved edit');
    heldSaves.splice(0).forEach((resolve) => resolve());
    holdSaves = false;
    await saving.catch(() => {});
  });
});
