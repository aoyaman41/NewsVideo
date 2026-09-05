import { app, dialog } from 'electron';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import { registerOperation } from './operations';
import { getProjectRepository } from './project';
import { diagnosticProject } from '../../shared/project/metrics';
import { fileAccess } from '../utils/fileAccess';
registerOperation('diagnostics:export', async () => {
  const selection = await dialog.showSaveDialog({
    title: '内容を確認して共有する診断ファイル',
    defaultPath: 'newsvideo-diagnostics.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (selection.canceled || !selection.filePath) return null;
  const repo = getProjectRepository();
  const projects = await Promise.all(
    (await repo.directories()).map(async (directory) => {
      try {
        return diagnosticProject(await repo.readDirectory(directory));
      } catch {
        return { storageError: 'unreadable' };
      }
    })
  );
  const data = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    electronVersion: process.versions.electron,
    projects,
    privacy: 'No article text, prompts, names, paths, API keys or network transmission.',
  };
  await fileAccess().grant(selection.filePath, true);
  await fs.writeFile(selection.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  return selection.filePath;
});
