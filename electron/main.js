import { app, BrowserWindow, protocol, net } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
// ESM環境での __dirname 相当を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 開発環境かどうか
const isDev = !app.isPackaged;
// カスタムプロトコル 'local-file' を登録
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'local-file',
        privileges: {
            secure: true,
            supportFetchAPI: true,
            bypassCSP: true,
            stream: true,
        },
    },
]);
let mainWindow = null;
function createWindow() {
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
        mainWindow.webContents.openDevTools();
    }
    else {
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
    protocol.handle('local-file', (request) => {
        // local-file://path/to/file から実際のファイルパスを取得
        const filePath = decodeURIComponent(request.url.replace('local-file://', ''));
        return net.fetch(pathToFileURL(filePath).href);
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
