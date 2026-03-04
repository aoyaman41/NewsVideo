import { app, BrowserWindow, protocol } from 'electron';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM環境での __dirname 相当を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 開発環境かどうか
const isDev = !app.isPackaged;
const shouldOpenDevTools = isDev && process.env.NEWSVIDEO_OPEN_DEVTOOLS === '1';

// カスタムプロトコル 'local-file' を登録
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: {
      secure: true,
      standard: true,
      corsEnabled: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

function toWebReadableStream(nodeStream: fs.ReadStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

function parseLocalFileRequestUrl(requestUrl: string): string {
  // Electron/Chromium may canonicalize `local-file:///Users/...` into either:
  // - host=""  pathname="/Users/..."
  // - host="Users" pathname="/aoyaman/..."  (i.e. "/{host}{pathname}")
  // So we must parse via URL to reconstruct the full absolute path reliably.
  const url = new URL(requestUrl);
  const combined = url.host ? `/${url.host}${url.pathname}` : url.pathname;

  let filePath = decodeURIComponent(combined);

  // Normalize multiple leading slashes (can happen with legacy encoded URLs like local-file://%2FUsers...).
  if (process.platform !== 'win32') {
    filePath = filePath.replace(/^\/{2,}/, '/');
  }

  // Windows: local-file:///C%3A/... -> "/C:/..." になるので先頭スラッシュを落とす
  if (process.platform === 'win32' && /^\/[A-Za-z]:[\\/]/.test(filePath)) {
    filePath = filePath.slice(1);
  }

  return filePath;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.m4v':
      return 'video/x-m4v';
    case '.webm':
      return 'video/webm';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  // 開発環境ではViteのdev serverに接続
  if (isDev) {
    const port = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(port);
    if (shouldOpenDevTools) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// アプリケーションの準備完了時
app.whenReady().then(() => {
  // カスタムプロトコルハンドラを登録
  protocol.handle('local-file', async (request) => {
    const filePath = parseLocalFileRequestUrl(request.url);

    try {
      const stat = await fsPromises.stat(filePath);
      if (!stat.isFile()) {
        return new Response('Not found', { status: 404 });
      }

      const size = stat.size;
      const contentType = getMimeType(filePath);
      const range = request.headers.get('range');

      const baseHeaders = new Headers();
      baseHeaders.set('Content-Type', contentType);
      baseHeaders.set('Accept-Ranges', 'bytes');
      // fetch()/Range を使う場合に備えて CORS を緩める（アプリ内のローカル用途）
      baseHeaders.set('Access-Control-Allow-Origin', '*');
      baseHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Accept');
      baseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: baseHeaders });
      }

      // Range対応（動画再生で必須）
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        if (!m) {
          return new Response('Invalid Range', { status: 416 });
        }

        const startRaw = m[1];
        const endRaw = m[2];

        let start: number;
        let end: number;

        if (startRaw === '' && endRaw !== '') {
          // suffix-byte-range-spec: bytes=-N
          const suffix = Number(endRaw);
          if (!Number.isFinite(suffix) || suffix <= 0) {
            return new Response('Invalid Range', { status: 416 });
          }
          start = Math.max(0, size - suffix);
          end = size - 1;
        } else {
          start = startRaw ? Number(startRaw) : 0;
          end = endRaw ? Number(endRaw) : size - 1;
        }

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
          return new Response('Invalid Range', { status: 416 });
        }

        if (start >= size) {
          const headers = new Headers(baseHeaders);
          headers.set('Content-Range', `bytes */${size}`);
          return new Response('Range Not Satisfiable', { status: 416, headers });
        }

        end = Math.min(end, size - 1);
        const chunkSize = end - start + 1;

        const headers = new Headers(baseHeaders);
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
        headers.set('Content-Length', String(chunkSize));

        if (request.method === 'HEAD') {
          return new Response(null, { status: 206, headers });
        }

        const nodeStream = fs.createReadStream(filePath, { start, end });
        const stream = toWebReadableStream(nodeStream);
        return new Response(stream, { status: 206, headers });
      }

      baseHeaders.set('Content-Length', String(size));
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: baseHeaders });
      }

      const nodeStream = fs.createReadStream(filePath);
      const stream = toWebReadableStream(nodeStream);
      return new Response(stream, { status: 200, headers: baseHeaders });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// すべてのウィンドウが閉じられた時
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC ハンドラーの登録
import './ipc/project.js';
import './ipc/settings.js';
import './ipc/ai.js';
import './ipc/image.js';
import './ipc/tts.js';
import './ipc/file.js';
import './ipc/video.js';
