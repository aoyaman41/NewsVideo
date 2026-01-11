import { dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

type FileDialogOptions = {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
};

function toBuffer(content: unknown): Buffer {
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  throw new Error('Invalid file content: expected Buffer/ArrayBuffer/TypedArray');
}

ipcMain.handle('file:selectFile', async (_, options: FileDialogOptions = {}) => {
  const result = await dialog.showOpenDialog({
    title: options.title,
    filters: options.filters,
    properties: options.properties ?? ['openFile'],
  });

  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});

ipcMain.handle('file:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });

  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});

ipcMain.handle('file:readFile', async (_, filePath: string) => {
  return fs.readFile(filePath);
});

ipcMain.handle('file:writeFile', async (_, filePath: string, content: unknown) => {
  await fs.writeFile(filePath, toBuffer(content));
  return { success: true };
});

ipcMain.handle('file:exists', async (_, filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('file:listFiles', async (_, dirPath: string) => {
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

ipcMain.handle('file:revealInFinder', async (_, targetPath: string) => {
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
    console.error('Failed to open path:', error);
    return { success: false };
  }
});
