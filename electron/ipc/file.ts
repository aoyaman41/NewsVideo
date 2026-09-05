import { fileAccess } from '../utils/fileAccess';
import { registerOperation } from './operations';
import { dialog, shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../utils/logger';

type FileDialogOptions = {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
};

registerOperation('file:selectFile', async (_, options: FileDialogOptions = {}) => {
  const result = await dialog.showOpenDialog({
    title: options.title,
    filters: options.filters,
    properties: options.properties ?? ['openFile'],
  });

  if (result.canceled) return null;
  const selected = result.filePaths[0];
  if (selected) await fileAccess().grant(selected, false);
  return selected ?? null;
});

registerOperation('file:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });

  if (result.canceled) return null;
  const selected = result.filePaths[0];
  if (selected) await fileAccess().grant(selected, true, true);
  return selected ?? null;
});

registerOperation('file:exists', async (_, filePath: string) => {
  filePath = await fileAccess().media(filePath);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

registerOperation('file:listFiles', async (_, dirPath: string) => {
  dirPath = await fileAccess().assert(dirPath);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          return {
            path: fullPath,
            name: entry.name,
            isFile: entry.isFile(),
            mtimeMs: stat.mtimeMs,
          };
        } catch {
          return {
            path: fullPath,
            name: entry.name,
            isFile: entry.isFile(),
            mtimeMs: 0,
          };
        }
      })
    );
    return results;
  } catch {
    return [];
  }
});

registerOperation('file:revealInFinder', async (_, targetPath: string) => {
  targetPath = await fileAccess().assert(targetPath);
  try {
    let openPath = targetPath;
    try {
      const stat = await fs.stat(targetPath);
      if (stat.isFile()) {
        openPath = path.dirname(targetPath);
      }
    } catch {
      // ignore and try opening as-is
    }
    await shell.openPath(openPath);
    return { success: true };
  } catch (error) {
    logger.error('Failed to open path', error);
    return { success: false };
  }
});
