import { productionMetrics } from '../../shared/project/metrics';
import { PURPOSES } from '../../shared/project/purposes';
import { populateSample } from '../project/sample';
import { ProjectLifecycle } from '../project/lifecycle';
import { fileAccess } from '../utils/fileAccess';
import { dialog } from 'electron';
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
          metrics: productionMetrics(project),
          archived: project.archived,
          template: project.template,
          durationSec: project.parts.reduce((sum, part) => sum + (part.audio?.durationSec ?? part.durationEstimateSec), 0),
          thumbnailPath: [...project.images, ...project.article.importedImages].find((image) => image.id === (project.thumbnail?.imageId ?? project.parts[0]?.panelImages[0]?.imageId))?.filePath,
          lastVideoPath: project.autoGenerationStatus?.lastVideoPath,
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
  const request = z.union([z.string(), z.object({ name: z.string(), purpose: z.enum(['short', 'explain', 'news']).optional(), sample: z.boolean().optional() })]).parse(input);
  const name = z.string().trim().min(1).max(200).parse(typeof request === 'string' ? request : request.name || '新しい動画');
  const project = createNewProject(name, '');
  try {
    const settings = normalizeSettings(
      JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'))
    );
    project.presentationProfile.aspectRatio = settings.defaultAspectRatio;
  } catch {
    /* Defaults work before settings exist. */
  }
  if (typeof request !== 'string' && request.purpose) { const purpose = PURPOSES.find((item) => item.id === request.purpose)!; project.presentationProfile = structuredClone(purpose.profile); project.generationConfig = { targetPartCount: purpose.parts }; }
  const created = await getProjectRepository().create(project);
  if (typeof request !== 'string' && request.sample) return populateSample(getProjectRepository(), created);
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

registerOperation('project:manage', async (_, request: unknown) => {
  const input = z.discriminatedUnion('action', [
    z.object({ action: z.literal('clone'), id: z.string().uuid(), template: z.boolean().optional() }),
    z.object({ action: z.literal('archive'), id: z.string().uuid(), archived: z.boolean() }),
    z.object({ action: z.literal('export'), id: z.string().uuid() }),
    z.object({ action: z.literal('import') }),
    z.object({ action: z.literal('trash') }),
    z.object({ action: z.literal('restore'), key: z.string() }),
  ]).parse(request);
  const lifecycle = new ProjectLifecycle(getProjectRepository(), (file) => fileAccess().media(file));
  if (input.action === 'trash') return lifecycle.trash();
  if (input.action === 'archive') { const project = await getProjectRepository().update(input.id, (data) => { data.archived = input.archived; }); changed(project.id, project.revision); return project; }
  if (input.action === 'clone') return lifecycle.clone(input.id, input.template);
  if (input.action === 'restore') return lifecycle.restore(input.key);
  const selection = await dialog.showOpenDialog({ title: input.action === 'export' ? 'バックアップの保存先' : '復元する .newsbackup フォルダー', properties: ['openDirectory'] });
  if (selection.canceled || !selection.filePaths[0]) return null;
  const selected = selection.filePaths[0];
  if (input.action === 'export') { await fileAccess().grant(selected, true, true); return lifecycle.export(input.id, selected); }
  return lifecycle.import(selected);
});
