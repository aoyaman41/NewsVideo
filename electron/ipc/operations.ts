import { ipcMain, app } from 'electron';
import { isTrustedRenderer } from '../utils/ipcOrigin';

const operations = new Map<string, Parameters<typeof ipcMain.handle>[1]>();

/** Both IPC and Main jobs call the same application operations. */
export function registerOperation(name: string, handler: Parameters<typeof ipcMain.handle>[1]) {
  operations.set(name, handler);
  ipcMain.handle(name, (event, ...args) => {
    const frame = event?.senderFrame;
    const devUrl = process.env.NEWSVIDEO_RENDERER_URL || process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    if (!frame || frame.parent || !isTrustedRenderer(frame.url, app.isPackaged, app.getAppPath(), devUrl)) throw new Error('許可されていない画面からの要求です。');
    return handler(event, ...args);
  });
}

export async function invokeOperation<T>(name: string, ...args: unknown[]): Promise<T> {
  const operation = operations.get(name);
  if (!operation) throw new Error(`Unknown operation: ${name}`);
  return operation(undefined as unknown as Electron.IpcMainInvokeEvent, ...args) as Promise<T>;
}
