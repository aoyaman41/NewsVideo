import { app, BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { GenerationJobEngine } from '../jobs/engine';
import { getProjectRepository } from './project';
import { invokeOperation } from './operations';
import { normalizeSettings } from '../../shared/settings/appSettings';

let engine: GenerationJobEngine;
const ready = app.whenReady().then(async () => {
  engine = new GenerationJobEngine(
    getProjectRepository(),
    invokeOperation,
    async () => normalizeSettings(await invokeOperation('settings:get')),
    (project) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('project:changed', { id: project.id, revision: project.revision });
        window.webContents.send('job:statusChange', { projectId: project.id, job: project.job });
      }
    }
  );
  await engine.recover();
});

const optionsSchema = z.object({
  mode: z.enum(['automatic', 'review']),
  targetPartCount: z.number().int().min(1).max(20),
  budgetUsd: z.number().nonnegative().optional(),
  restart: z.boolean().optional(),
});
ipcMain.handle('jobs:start', async (_, id: unknown, options: unknown) => {
  await ready;
  return engine.start(z.string().uuid().parse(id), optionsSchema.parse(options));
});
ipcMain.handle('jobs:cancel', async (_, id: unknown) => {
  await ready;
  await engine.cancel(z.string().uuid().parse(id));
  return { success: true };
});
