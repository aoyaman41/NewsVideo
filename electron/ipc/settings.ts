import { ipcMain, app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

// 設定ファイルのパス
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');

// デフォルト設定
type TTSEngine = 'google_tts' | 'gemini_tts' | 'macos_tts';
type ImageModel = 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
type TextCompletionModel = 'gpt-5.2' | 'gemini-3.1-pro';
type ImageResolution = 'fhd' | '2k' | '4k';
const SUPPORTED_IMAGE_MODELS: readonly ImageModel[] = [
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
];
const SUPPORTED_TEXT_MODELS: readonly TextCompletionModel[] = ['gpt-5.2', 'gemini-3.1-pro'];
const SUPPORTED_IMAGE_RESOLUTIONS: readonly ImageResolution[] = ['fhd', '2k', '4k'];

const defaultSettings = {
  // TTS設定
  ttsEngine: 'gemini_tts' as TTSEngine,
  ttsVoice: 'Charon',
  ttsSpeakingRate: 1.0,
  ttsPitch: 0,
  scriptTextModel: 'gpt-5.2' as TextCompletionModel,
  imagePromptTextModel: 'gpt-5.2' as TextCompletionModel,

  // 画像設定
  imageStylePreset: 'news_panel',
  imageModel: 'gemini-3.1-flash-image-preview' as ImageModel,
  imageResolution: 'fhd' as ImageResolution,
  defaultAspectRatio: '16:9' as const,

  // 動画設定
  videoResolution: '1920x1080' as const,
  videoFps: 30,
  videoBitrate: '8M',
  audioBitrate: '192k',
  // パート切替後、読み上げ開始までの「間」（秒）
  videoPartLeadInSec: 0.3,
  openingVideoPath: '',
  endingVideoPath: '',

  // その他
  autoSaveInterval: 60, // 秒
  defaultProjectDir: '',
};

type Settings = typeof defaultSettings;

// APIキーの種類
type ApiKeyService = 'openai' | 'google_ai' | 'google_tts';

// ============================================
// 内部ロジック（共通関数）
// ============================================

async function readSettings(): Promise<Settings> {
  try {
    const settingsPath = getSettingsPath();
    const content = await fs.readFile(settingsPath, 'utf-8');
    const merged = { ...defaultSettings, ...JSON.parse(content) } as Settings;
    // 旧ボイス名の移行
    if (merged.ttsVoice === 'ja-JP-Chirp3-HD-Aoife') {
      merged.ttsVoice = defaultSettings.ttsVoice;
    }
    // 本アプリでは Gemini TTS をデフォルト運用にする
    merged.ttsEngine = 'gemini_tts';
    // 旧Google/macos系のボイス名が残っている場合はGemini側のデフォルトへ寄せる
    if (!merged.ttsVoice || merged.ttsVoice.includes('-')) {
      merged.ttsVoice = defaultSettings.ttsVoice;
    }
    if (!SUPPORTED_IMAGE_MODELS.includes(merged.imageModel)) {
      merged.imageModel = defaultSettings.imageModel;
    }
    if (!SUPPORTED_IMAGE_RESOLUTIONS.includes(merged.imageResolution)) {
      merged.imageResolution = defaultSettings.imageResolution;
    }
    if (!SUPPORTED_TEXT_MODELS.includes(merged.scriptTextModel)) {
      merged.scriptTextModel = defaultSettings.scriptTextModel;
    }
    if (!SUPPORTED_TEXT_MODELS.includes(merged.imagePromptTextModel)) {
      merged.imagePromptTextModel = defaultSettings.imagePromptTextModel;
    }
    return merged;
  } catch {
    return defaultSettings;
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
ipcMain.handle('settings:set', async (_, settings: Partial<Settings>) => {
  const settingsPath = getSettingsPath();
  const currentSettings = await readSettings();
  const newSettings = { ...currentSettings, ...settings };

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
