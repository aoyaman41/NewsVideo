import { registerOperation } from './operations';
import { getProjectProgress } from '../../shared/project/progress';
import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { ProjectRepository } from '../project/repository';
import { createNewProject } from '../../shared/project/schema';
import { normalizeSettings } from '../../shared/settings/appSettings';

export const getProjectRepository = () => {
  repository ??= new ProjectRepository(path.join(app.getPath('userData'), 'projects'));
  return repository;
};
let repository: ProjectRepository | undefined;

function changed(id: string, revision?: number) {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('project:changed', { id, revision });
}

registerOperation('project:list', async () => {
  const repo = getProjectRepository();
  const results = await Promise.all(
    (await repo.directories()).map(async (directory) => {
      try {
        const project = await repo.readDirectory(directory);
        return {
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          path: directory,
          articleTitle: project.article.title,
          thumbnailImageId: project.thumbnail?.imageId,
          summary: getProjectProgress(project),
        };
      } catch (error) {
        return {
          id: path.basename(directory),
          name: path.basename(directory),
          path: directory,
          createdAt: '',
          updatedAt: '',
          storageError: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
});

registerOperation('project:create', async (_, input: unknown) => {
  const name = z.string().trim().min(1).max(200).parse(input);
  const project = createNewProject(name, '');
  try {
    const settings = normalizeSettings(
      JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'))
    );
    project.presentationProfile.aspectRatio = settings.defaultAspectRatio;
  } catch {
    /* Defaults work before settings exist. */
  }
  const created = await getProjectRepository().create(project);
  changed(created.id, created.revision);
  return created;
});
registerOperation('project:load', (_, id: unknown) =>
  getProjectRepository().load(z.string().uuid().parse(id))
);
registerOperation('project:save', async (_, input: unknown) => {
  const saved = await getProjectRepository().save(input);
  changed(saved.id, saved.revision);
  return { success: true, savedAt: saved.updatedAt, revision: saved.revision, project: saved };
});
registerOperation('project:delete', async (_, input: unknown) => {
  const id = z.string().uuid().parse(input);
  const repo = getProjectRepository();
  const directory = await repo.resolve(id);
  const trash = path.join(path.dirname(repo.root), 'trash');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(directory, path.join(trash, `${Date.now()}-${path.basename(directory)}`));
  changed(id);
  return { success: true };
});
