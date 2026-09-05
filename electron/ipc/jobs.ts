import { registerOperation } from './operations';
import { app, BrowserWindow } from 'electron';
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
registerOperation('jobs:start', async (_, id: unknown, options: unknown) => {
  await ready;
  return engine.start(z.string().uuid().parse(id), optionsSchema.parse(options));
});
registerOperation('jobs:cancel', async (_, id: unknown) => {
  await ready;
  await engine.cancel(z.string().uuid().parse(id));
  return { success: true };
});

registerOperation('jobs:recoverAsset', async (_, input: unknown) => {
  const request = z
    .object({
      projectId: z.string().uuid(),
      index: z.number().int().nonnegative(),
      jobId: z.string().uuid().optional(),
      partId: z.string().uuid(),
    })
    .parse(input);
  const { imageAssetSchema, audioAssetSchema } = await import('../../shared/project/schema');
  const { fileAccess } = await import('../utils/fileAccess');
  const repo = getProjectRepository();
  const project = await repo.load(request.projectId);
  const sourceJob = [project.job, ...(project.jobHistory ?? [])].find(
    (job) => job && (!request.jobId || job.id === request.jobId)
  );
  const output = sourceJob?.outputs[request.index];
  if (!output || !project.parts.some((part) => part.id === request.partId))
    throw new Error('復元する素材とシーンを確認してください。');
  const image = imageAssetSchema.safeParse(output.payload);
  const audio = audioAssetSchema.safeParse((output.payload as { audio?: unknown })?.audio);
  if (!image.success && !audio.success) throw new Error('この履歴は画像・音声素材ではありません。');
  await fileAccess().media(image.success ? image.data.filePath : audio.data!.filePath);
  const saved = await repo.update(project.id, (data) => {
    const part = data.parts.find((item) => item.id === request.partId);
    if (!part) throw new Error('シーンが変更されました。再度選択してください。');
    if (image.success) {
      if (!data.images.some((item) => item.id === image.data.id)) data.images.push(image.data);
      part.panelImages = [{ imageId: image.data.id }];
    }
    if (audio.success) {
      if (!data.audio.some((item) => item.id === audio.data.id)) data.audio.push(audio.data);
      part.audio = audio.data;
    }
  });
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('project:changed', { id: saved.id, revision: saved.revision });
  return { success: true };
});
