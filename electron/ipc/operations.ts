import { ipcMain } from 'electron';

const operations = new Map<string, Parameters<typeof ipcMain.handle>[1]>();

/** Both IPC and Main jobs call the same application operations. */
export function registerOperation(name: string, handler: Parameters<typeof ipcMain.handle>[1]) {
  operations.set(name, handler);
  ipcMain.handle(name, handler);
}

export async function invokeOperation<T>(name: string, ...args: unknown[]): Promise<T> {
  const operation = operations.get(name);
  if (!operation) throw new Error(`Unknown operation: ${name}`);
  return operation(undefined as unknown as Electron.IpcMainInvokeEvent, ...args) as Promise<T>;
}
