import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseSettingsUpdate,
  type AppSettings,
} from '../../shared/settings/appSettings';

// 設定ファイルのパス
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');

type Settings = AppSettings;

// APIキーの種類
type ApiKeyService = 'openai' | 'google_ai' | 'google_tts';

// ============================================
// 内部ロジック（共通関数）
// ============================================

async function readSettings(): Promise<Settings> {
  try {
    const settingsPath = getSettingsPath();
    const content = await fs.readFile(settingsPath, 'utf-8');
    return normalizeSettings(JSON.parse(content));
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

async function readApiKey(service: ApiKeyService): Promise<string | null> {
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
  } catch {
    return null;
  }
}

// ============================================
// IPC ハンドラー
// ============================================

// 設定取得
ipcMain.handle('settings:get', async (): Promise<Settings> => {
  return readSettings();
});

// 設定保存
ipcMain.handle('settings:set', async (_, settings: unknown) => {
  const settingsPath = getSettingsPath();
  const currentSettings = await readSettings();
  const validatedSettings = parseSettingsUpdate(settings);
  const newSettings = normalizeSettings({ ...currentSettings, ...validatedSettings });

  await fs.writeFile(settingsPath, JSON.stringify(newSettings, null, 2));
  return { success: true };
});

// APIキー取得（暗号化ストレージから）
ipcMain.handle('settings:getApiKey', async (_, service: ApiKeyService): Promise<string | null> => {
  return readApiKey(service);
});

// APIキー保存（暗号化ストレージへ）
ipcMain.handle(
  'settings:setApiKey',
  async (_, service: ApiKeyService, apiKey: string): Promise<{ success: boolean }> => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available');
    }

    const secretsPath = getSecretsPath();
    let secrets: Record<string, string> = {};

    // 既存のシークレットを読み込み
    try {
      const encryptedData = await fs.readFile(secretsPath);
      const decrypted = safeStorage.decryptString(encryptedData);
      secrets = JSON.parse(decrypted);
    } catch {
      // ファイルが存在しない場合は新規作成
    }

    // 更新して保存
    secrets[service] = apiKey;
    const encrypted = safeStorage.encryptString(JSON.stringify(secrets));
    await fs.writeFile(secretsPath, encrypted);

    return { success: true };
  }
);

// 接続テスト
ipcMain.handle(
  'settings:testConnection',
  async (
    _,
    service: ApiKeyService,
    inputApiKey?: string
  ): Promise<{ success: boolean; message: string; latencyMs?: number }> => {
    const startTime = Date.now();

    try {
      // 入力されたAPIキーがあればそれを使用、なければ保存済みのキーを取得
      const apiKey = inputApiKey || (await readApiKey(service));

      if (!apiKey) {
        return { success: false, message: 'APIキーが設定されていません' };
      }

      let response: Response;

      switch (service) {
        case 'openai':
          response = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          break;

        case 'google_ai':
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
          );
          break;

        case 'google_tts':
          response = await fetch(
            `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`
          );
          break;

        default:
          return { success: false, message: '不明なサービスです' };
      }

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        return { success: true, message: '接続成功', latencyMs };
      } else {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        return {
          success: false,
          message: `接続失敗: ${response.status} ${errorData.error?.message || response.statusText}`,
          latencyMs,
        };
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        message: `接続エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
        latencyMs,
      };
    }
  }
);
