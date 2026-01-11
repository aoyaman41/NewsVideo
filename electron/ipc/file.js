import { dialog, ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
function toBuffer(content) {
    if (Buffer.isBuffer(content))
        return content;
    if (content instanceof ArrayBuffer)
        return Buffer.from(content);
    if (ArrayBuffer.isView(content)) {
        return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    }
    throw new Error('Invalid file content: expected Buffer/ArrayBuffer/TypedArray');
}
ipcMain.handle('file:selectFile', async (_, options = {}) => {
    const result = await dialog.showOpenDialog({
        title: options.title,
        filters: options.filters,
        properties: options.properties ?? ['openFile'],
    });
    if (result.canceled)
        return null;
    return result.filePaths[0] ?? null;
});
ipcMain.handle('file:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
    });
    if (result.canceled)
        return null;
    return result.filePaths[0] ?? null;
});
ipcMain.handle('file:readFile', async (_, filePath) => {
    return fs.readFile(filePath);
});
ipcMain.handle('file:writeFile', async (_, filePath, content) => {
    await fs.writeFile(filePath, toBuffer(content));
    return { success: true };
});
ipcMain.handle('file:exists', async (_, filePath) => {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
});
ipcMain.handle('file:listFiles', async (_, dirPath) => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const results = await Promise.all(entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            try {
                const stat = await fs.stat(fullPath);
                return {
                    path: fullPath,
                    name: entry.name,
                    isFile: entry.isFile(),
                    mtimeMs: stat.mtimeMs,
                };
            }
            catch {
                return {
                    path: fullPath,
                    name: entry.name,
                    isFile: entry.isFile(),
                    mtimeMs: 0,
                };
            }
        }));
        return results;
    }
    catch {
        return [];
    }
});
