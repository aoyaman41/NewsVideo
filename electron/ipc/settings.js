import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
// 設定ファイルのパス
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');
// デフォルト設定
const defaultSettings = {
    // TTS設定
    ttsEngine: 'google_tts',
    ttsVoice: 'ja-JP-Chirp3-HD-Zephyr',
    ttsSpeakingRate: 1.0,
    ttsPitch: 0,
    // 画像設定
    imageStylePreset: 'news_panel',
    defaultAspectRatio: '16:9',
    // 動画設定
    videoResolution: '1920x1080',
    videoFps: 30,
    videoBitrate: '8M',
    audioBitrate: '192k',
    // その他
    autoSaveInterval: 60, // 秒
    defaultProjectDir: '',
};
// ============================================
// 内部ロジック（共通関数）
// ============================================
async function readSettings() {
    try {
        const settingsPath = getSettingsPath();
        const content = await fs.readFile(settingsPath, 'utf-8');
        const merged = { ...defaultSettings, ...JSON.parse(content) };
        if (merged.ttsVoice === 'ja-JP-Chirp3-HD-Aoife') {
            merged.ttsVoice = defaultSettings.ttsVoice;
        }
        return merged;
    }
    catch {
        return defaultSettings;
    }
}
async function readApiKey(service) {
    if (!safeStorage.isEncryptionAvailable()) {
        console.warn('Encryption is not available');
        return null;
    }
    try {
        const secretsPath = getSecretsPath();
        const encryptedData = await fs.readFile(secretsPath);
        const decrypted = safeStorage.decryptString(encryptedData);
        const secrets = JSON.parse(decrypted);
        return secrets[service] || null;
    }
    catch {
        return null;
    }
}
// ============================================
// IPC ハンドラー
// ============================================
// 設定取得
ipcMain.handle('settings:get', async () => {
    return readSettings();
});
// 設定保存
ipcMain.handle('settings:set', async (_, settings) => {
    const settingsPath = getSettingsPath();
    const currentSettings = await readSettings();
    const newSettings = { ...currentSettings, ...settings };
    await fs.writeFile(settingsPath, JSON.stringify(newSettings, null, 2));
    return { success: true };
});
// APIキー取得（暗号化ストレージから）
ipcMain.handle('settings:getApiKey', async (_, service) => {
    return readApiKey(service);
});
// APIキー保存（暗号化ストレージへ）
ipcMain.handle('settings:setApiKey', async (_, service, apiKey) => {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is not available');
    }
    const secretsPath = getSecretsPath();
    let secrets = {};
    // 既存のシークレットを読み込み
    try {
        const encryptedData = await fs.readFile(secretsPath);
        const decrypted = safeStorage.decryptString(encryptedData);
        secrets = JSON.parse(decrypted);
    }
    catch {
        // ファイルが存在しない場合は新規作成
    }
    // 更新して保存
    secrets[service] = apiKey;
    const encrypted = safeStorage.encryptString(JSON.stringify(secrets));
    await fs.writeFile(secretsPath, encrypted);
    return { success: true };
});
// 接続テスト
ipcMain.handle('settings:testConnection', async (_, service, inputApiKey) => {
    const startTime = Date.now();
    try {
        // 入力されたAPIキーがあればそれを使用、なければ保存済みのキーを取得
        const apiKey = inputApiKey || (await readApiKey(service));
        if (!apiKey) {
            return { success: false, message: 'APIキーが設定されていません' };
        }
        let response;
        switch (service) {
            case 'openai':
                response = await fetch('https://api.openai.com/v1/models', {
                    headers: { Authorization: `Bearer ${apiKey}` },
                });
                break;
            case 'google_ai':
                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                break;
            case 'google_tts':
                response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`);
                break;
            default:
                return { success: false, message: '不明なサービスです' };
        }
        const latencyMs = Date.now() - startTime;
        if (response.ok) {
            return { success: true, message: '接続成功', latencyMs };
        }
        else {
            const errorData = await response.json().catch(() => ({}));
            return {
                success: false,
                message: `接続失敗: ${response.status} ${errorData.error?.message || response.statusText}`,
                latencyMs,
            };
        }
    }
    catch (error) {
        const latencyMs = Date.now() - startTime;
        return {
            success: false,
            message: `接続エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
            latencyMs,
        };
    }
});
