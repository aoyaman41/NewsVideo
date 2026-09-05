import { ipcMain, app, BrowserWindow } from 'electron';
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

type WorkflowStage = 'article' | 'script' | 'image' | 'audio' | 'video';

interface ProjectProgressSummary {
  stage: WorkflowStage;
  completedSteps: number;
  totalSteps: 5;
  partCount: number;
  missingPrompts: number;
  missingImages: number;
  missingAudio: number;
  hasVideoOutput: boolean;
}

interface ProjectSnapshot {
  article?: { title?: string; bodyText?: string };
  parts?: Array<{ id: string; panelImages?: unknown[]; audio?: unknown }>;
  prompts?: Array<{ partId: string; createdAt: string }>;
  autoGenerationStatus?: { lastVideoPath?: string };
}

function hasText(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function summarizeProject(snapshot: ProjectSnapshot): ProjectProgressSummary {
  const parts = Array.isArray(snapshot.parts) ? snapshot.parts : [];
  const prompts = Array.isArray(snapshot.prompts) ? snapshot.prompts : [];

  const latestPromptByPart = new Map<string, string>();
  for (const prompt of prompts) {
    if (!prompt?.partId) continue;
    const currentCreatedAt = latestPromptByPart.get(prompt.partId);
    if (!currentCreatedAt || prompt.createdAt >= currentCreatedAt) {
      latestPromptByPart.set(prompt.partId, prompt.createdAt);
    }
  }

  const partCount = parts.length;
  const missingPrompts = parts.reduce((count, part) => {
    return latestPromptByPart.has(part.id) ? count : count + 1;
  }, 0);
  const missingImages = parts.reduce((count, part) => {
    return (part.panelImages?.length ?? 0) > 0 ? count : count + 1;
  }, 0);
  const missingAudio = parts.reduce((count, part) => {
    return part.audio ? count : count + 1;
  }, 0);

  const hasArticle = hasText(snapshot.article?.title) && hasText(snapshot.article?.bodyText);
  const hasScript = partCount > 0;
  const hasImage = hasScript && missingPrompts === 0 && missingImages === 0;
  const hasAudio = hasScript && missingAudio === 0;
  const hasVideoOutput = Boolean(snapshot.autoGenerationStatus?.lastVideoPath);

  let stage: WorkflowStage = 'video';
  if (!hasArticle) {
    stage = 'article';
  } else if (!hasScript) {
    stage = 'script';
  } else if (!hasImage) {
    stage = 'image';
  } else if (!hasAudio) {
    stage = 'audio';
  }

  const completedSteps = [hasArticle, hasScript, hasImage, hasAudio, hasVideoOutput].filter(
    Boolean
  ).length;

  return {
    stage,
    completedSteps,
    totalSteps: 5,
    partCount,
    missingPrompts,
    missingImages,
    missingAudio,
    hasVideoOutput,
  };
}

function changed(id: string, revision?: number) {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('project:changed', { id, revision });
}

ipcMain.handle('project:list', async () => {
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
          summary: summarizeProject(project),
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

ipcMain.handle('project:create', async (_, input: unknown) => {
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
ipcMain.handle('project:load', (_, id: unknown) =>
  getProjectRepository().load(z.string().uuid().parse(id))
);
ipcMain.handle('project:save', async (_, input: unknown) => {
  const saved = await getProjectRepository().save(input);
  changed(saved.id, saved.revision);
  return { success: true, savedAt: saved.updatedAt, revision: saved.revision, project: saved };
});
ipcMain.handle('project:delete', async (_, input: unknown) => {
  const id = z.string().uuid().parse(input);
  const repo = getProjectRepository();
  const directory = await repo.resolve(id);
  const trash = path.join(path.dirname(repo.root), 'trash');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(directory, path.join(trash, `${Date.now()}-${path.basename(directory)}`));
  changed(id);
  return { success: true };
});
