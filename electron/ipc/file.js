import { dialog, ipcMain } from 'electron';
import * as fs from 'fs/promises';
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
