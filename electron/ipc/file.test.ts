import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const handlers = new Map<string, IpcHandler>();
const mockHandle = vi.fn((channel: string, handler: IpcHandler) => {
  handlers.set(channel, handler);
});

const showOpenDialogMock = vi.fn();
const openPathMock = vi.fn();

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const accessMock = vi.fn();
const readdirMock = vi.fn();
const statMock = vi.fn();
const unlinkMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockHandle,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
  shell: {
    openPath: openPathMock,
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  access: accessMock,
  readdir: readdirMock,
  stat: statMock,
  unlink: unlinkMock,
}));

async function loadFileModule(): Promise<void> {
  handlers.clear();
  mockHandle.mockClear();
  showOpenDialogMock.mockReset();
  openPathMock.mockReset();
  readFileMock.mockReset();
  writeFileMock.mockReset();
  accessMock.mockReset();
  readdirMock.mockReset();
  statMock.mockReset();
  unlinkMock.mockReset();
  vi.resetModules();
  await import('./file');
}

function getHandler(channel: string): IpcHandler {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler not found: ${channel}`);
  }
  return handler;
}

describe('file IPC handlers', () => {
  beforeEach(async () => {
    await loadFileModule();
  });

  it('registers expected channels', () => {
    expect(handlers.has('file:selectFile')).toBe(true);
    expect(handlers.has('file:selectDirectory')).toBe(true);
    expect(handlers.has('file:readFile')).toBe(true);
    expect(handlers.has('file:writeFile')).toBe(true);
    expect(handlers.has('file:exists')).toBe(true);
    expect(handlers.has('file:listFiles')).toBe(true);
    expect(handlers.has('file:revealInFinder')).toBe(true);
  });

  it('uses openFile as default property in file:selectFile', async () => {
    showOpenDialogMock.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/example.txt'],
    });

    const handler = getHandler('file:selectFile');
    const result = await handler({});

    expect(showOpenDialogMock).toHaveBeenCalledWith({
      title: undefined,
      filters: undefined,
      properties: ['openFile'],
    });
    expect(result).toBe('/tmp/example.txt');
  });

  it('rejects invalid content in file:writeFile', async () => {
    const handler = getHandler('file:writeFile');

    await expect(handler({}, '/tmp/example.txt', 'plain-text')).rejects.toThrow(
      'Invalid file content'
    );
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('returns list entries even when stat fails for a file', async () => {
    readdirMock.mockResolvedValueOnce([
      {
        name: 'a.txt',
        isFile: () => true,
      },
      {
        name: 'b.txt',
        isFile: () => true,
      },
    ]);
    statMock.mockResolvedValueOnce({ mtimeMs: 111 });
    statMock.mockRejectedValueOnce(new Error('stat failed'));

    const handler = getHandler('file:listFiles');
    const result = (await handler({}, '/tmp/project')) as Array<{
      path: string;
      name: string;
      isFile: boolean;
      mtimeMs: number;
    }>;

    expect(result).toEqual([
      {
        path: path.join('/tmp/project', 'a.txt'),
        name: 'a.txt',
        isFile: true,
        mtimeMs: 111,
      },
      {
        path: path.join('/tmp/project', 'b.txt'),
        name: 'b.txt',
        isFile: true,
        mtimeMs: 0,
      },
    ]);
  });

  it('opens parent directory when file:revealInFinder receives a file path', async () => {
    statMock.mockResolvedValueOnce({
      isFile: () => true,
    });
    openPathMock.mockResolvedValueOnce('');

    const handler = getHandler('file:revealInFinder');
    const result = await handler({}, '/tmp/project/output/video.mp4');

    expect(openPathMock).toHaveBeenCalledWith(path.join('/tmp/project/output'));
    expect(result).toEqual({ success: true });
  });
});
