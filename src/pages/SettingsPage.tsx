import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from '../components/layout';

type ApiKeyService = 'openai' | 'google_ai' | 'google_tts';

interface ConnectionStatus {
  success: boolean;
  message: string;
  latencyMs?: number;
}

interface Settings {
  ttsEngine: 'google_tts' | 'gemini_tts' | 'macos_tts';
  ttsVoice: string;
  ttsSpeakingRate: number;
  ttsPitch: number;
  imageStylePreset: string;
  defaultAspectRatio: '16:9' | '1:1' | '9:16';
  videoResolution: '1920x1080' | '1280x720' | '3840x2160';
  videoFps: number;
  videoBitrate: string;
  audioBitrate: string;
  videoPartLeadInSec: number;
  openingVideoPath: string;
  endingVideoPath: string;
  autoSaveInterval: number;
  defaultProjectDir: string;
}

const defaultSettings: Settings = {
  ttsEngine: 'gemini_tts',
  ttsVoice: 'Charon',
  ttsSpeakingRate: 1.0,
  ttsPitch: 0,
  imageStylePreset: 'news_panel',
  defaultAspectRatio: '16:9',
  videoResolution: '1920x1080',
  videoFps: 30,
  videoBitrate: '8M',
  audioBitrate: '192k',
  videoPartLeadInSec: 0.3,
  openingVideoPath: '',
  endingVideoPath: '',
  autoSaveInterval: 60,
  defaultProjectDir: '',
};

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const returnTo = useMemo(() => {
    const state = location.state as { returnTo?: string } | null;
    if (!state || typeof state.returnTo !== 'string') return null;
    if (!state.returnTo || state.returnTo === '/settings') return null;
    return state.returnTo;
  }, [location.state]);

  const [apiKeys, setApiKeys] = useState<Record<ApiKeyService, string>>({
    openai: '',
    google_ai: '',
    google_tts: '',
  });
  const [connectionStatus, setConnectionStatus] = useState<
    Record<ApiKeyService, ConnectionStatus | null>
  >({
    openai: null,
    google_ai: null,
    google_tts: null,
  });
  const [isTesting, setIsTesting] = useState<Record<ApiKeyService, boolean>>({
    openai: false,
    google_ai: false,
    google_tts: false,
  });
  const [isSaving, setIsSaving] = useState<Record<ApiKeyService, boolean>>({
    openai: false,
    google_ai: false,
    google_tts: false,
  });
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    loadApiKeys();
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const loaded = await window.electronAPI.settings.get();
      setSettings({ ...defaultSettings, ...loaded });
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsSaved(false);
    try {
      await window.electronAPI.settings.set(settings);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const loadApiKeys = async () => {
    const services: ApiKeyService[] = ['openai', 'google_ai', 'google_tts'];
    const keys: Record<string, string> = {};

    for (const service of services) {
      try {
        const key = await window.electronAPI.settings.getApiKey(service);
        keys[service] = key ? '••••••••••••••••' : '';
      } catch {
        keys[service] = '';
      }
    }

    setApiKeys(keys as Record<ApiKeyService, string>);
  };

  const handleSaveApiKey = async (service: ApiKeyService) => {
    const key = apiKeys[service];
    if (!key || key === '••••••••••••••••') return;

    setIsSaving((prev) => ({ ...prev, [service]: true }));
    try {
      await window.electronAPI.settings.setApiKey(service, key);
      setApiKeys((prev) => ({ ...prev, [service]: '••••••••••••••••' }));
    } catch (error) {
      console.error('Failed to save API key:', error);
    } finally {
      setIsSaving((prev) => ({ ...prev, [service]: false }));
    }
  };

  const handleTestConnection = async (service: ApiKeyService) => {
    setIsTesting((prev) => ({ ...prev, [service]: true }));
    setConnectionStatus((prev) => ({ ...prev, [service]: null }));

    try {
      // 未保存の入力値がある場合はそれを使用してテスト
      const currentKey = apiKeys[service];
      const keyToTest =
        currentKey && currentKey !== '••••••••••••••••' ? currentKey : undefined;
      const result = await window.electronAPI.settings.testConnection(service, keyToTest);
      setConnectionStatus((prev) => ({ ...prev, [service]: result }));
    } catch (error) {
      setConnectionStatus((prev) => ({
        ...prev,
        [service]: {
          success: false,
          message: `エラー: ${error instanceof Error ? error.message : '不明'}`,
        },
      }));
    } finally {
      setIsTesting((prev) => ({ ...prev, [service]: false }));
    }
  };

  const serviceLabels: Record<ApiKeyService, { name: string; description: string; url: string }> = {
    openai: {
      name: 'OpenAI（スクリプト生成）',
      description: 'GPT-5.2を使用してスクリプトを生成します',
      url: 'https://platform.openai.com/',
    },
    google_ai: {
      name: 'Google AI（画像生成）',
      description: 'Gemini 3 Pro Imageを使用して画像を生成します',
      url: 'https://aistudio.google.com/',
    },
    google_tts: {
      name: 'Google TTS（音声合成）',
      description: 'Chirp 3 HDを使用して音声を合成します',
      url: 'https://console.cloud.google.com/',
    },
  };

  const handleSelectVideoFile = async (field: 'openingVideoPath' | 'endingVideoPath') => {
    try {
      const selected = await window.electronAPI.file.selectFile({
        title: field === 'openingVideoPath' ? 'オープニング動画を選択' : 'エンディング動画を選択',
        filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v'] }],
        properties: ['openFile'],
      });
      if (!selected) return;
      setSettings((prev) => ({ ...prev, [field]: selected }));
    } catch (error) {
      console.error('Failed to select video file:', error);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="設定"
        subtitle="APIキーとアプリケーション設定"
        actions={
          <button
            onClick={() => {
              if (returnTo) {
                navigate(returnTo);
                return;
              }
              navigate('/projects');
            }}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            戻る
          </button>
        }
      />

      {/* メインコンテンツ */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">API設定</h2>
            <p className="text-sm text-gray-500 mt-1">
              各サービスのAPIキーを設定してください
            </p>
          </div>

          <div className="divide-y divide-gray-200">
            {(Object.keys(serviceLabels) as ApiKeyService[]).map((service) => (
              <div key={service} className="px-6 py-6">
                <div className="mb-4">
                  <h3 className="text-base font-medium text-gray-900">
                    {serviceLabels[service].name}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {serviceLabels[service].description}
                  </p>
                  <a
                    href={serviceLabels[service].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline mt-1 inline-block"
                  >
                    APIキーを取得 →
                  </a>
                </div>

                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKeys[service]}
                    onChange={(e) =>
                      setApiKeys((prev) => ({ ...prev, [service]: e.target.value }))
                    }
                    placeholder="APIキーを入力"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  />
                  <button
                    onClick={() => handleSaveApiKey(service)}
                    disabled={
                      !apiKeys[service] ||
                      apiKeys[service] === '••••••••••••••••' ||
                      isSaving[service]
                    }
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    {isSaving[service] ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={() => handleTestConnection(service)}
                    disabled={isTesting[service]}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    {isTesting[service] ? 'テスト中...' : 'テスト'}
                  </button>
                </div>

                {/* 接続テスト結果 */}
                {connectionStatus[service] && (
                  <div
                    className={`mt-3 px-4 py-2 rounded-lg text-sm ${
                      connectionStatus[service]!.success
                        ? 'bg-green-50 text-green-800'
                        : 'bg-red-50 text-red-800'
                    }`}
                  >
                    <span className="font-medium">
                      {connectionStatus[service]!.success ? '✓ 成功' : '✗ 失敗'}
                    </span>
                    <span className="ml-2">{connectionStatus[service]!.message}</span>
                    {connectionStatus[service]!.latencyMs && (
                      <span className="ml-2 text-gray-500">
                        ({connectionStatus[service]!.latencyMs}ms)
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* デフォルト設定 */}
        <div className="max-w-2xl mx-auto mt-6 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">デフォルト設定</h2>
            <p className="text-sm text-gray-500 mt-1">
              新規プロジェクト作成時に適用される設定
            </p>
          </div>

          <div className="px-6 py-6 space-y-6">
            {/* 動画設定 */}
            <div>
              <h3 className="text-base font-medium text-gray-900 mb-4">動画設定</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    解像度
                  </label>
                  <select
                    value={settings.videoResolution}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        videoResolution: e.target.value as Settings['videoResolution'],
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="1920x1080">1920x1080 (Full HD)</option>
                    <option value="1280x720">1280x720 (HD)</option>
                    <option value="3840x2160">3840x2160 (4K)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    フレームレート
                  </label>
                  <select
                    value={settings.videoFps}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        videoFps: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={24}>24 fps</option>
                    <option value={30}>30 fps</option>
                    <option value={60}>60 fps</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    動画ビットレート
                  </label>
                  <input
                    type="text"
                    value={settings.videoBitrate}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        videoBitrate: e.target.value,
                      }))
                    }
                    placeholder="8M"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    音声ビットレート
                  </label>
                  <input
                    type="text"
                    value={settings.audioBitrate}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        audioBitrate: e.target.value,
                      }))
                    }
                    placeholder="192k"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    読み上げ開始までの間（秒）
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.05"
                      value={settings.videoPartLeadInSec}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          videoPartLeadInSec: Number.isFinite(Number(e.target.value))
                            ? Number(e.target.value)
                            : 0,
                        }))
                      }
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500">
                      パート切替後に画面が落ち着いてから読み上げを開始します
                    </p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    アスペクト比
                  </label>
                  <select
                    value={settings.defaultAspectRatio}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        defaultAspectRatio: e.target.value as Settings['defaultAspectRatio'],
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="16:9">16:9 (横長)</option>
                    <option value="9:16">9:16 (縦長)</option>
                    <option value="1:1">1:1 (正方形)</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    オープニング動画（任意）
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.openingVideoPath}
                      readOnly
                      placeholder="未設定"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleSelectVideoFile('openingVideoPath')}
                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      参照
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettings((prev) => ({ ...prev, openingVideoPath: '' }))}
                      disabled={!settings.openingVideoPath}
                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      クリア
                    </button>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    エンディング動画（任意）
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.endingVideoPath}
                      readOnly
                      placeholder="未設定"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleSelectVideoFile('endingVideoPath')}
                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      参照
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettings((prev) => ({ ...prev, endingVideoPath: '' }))}
                      disabled={!settings.endingVideoPath}
                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      クリア
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 音声設定 */}
            <div>
              <h3 className="text-base font-medium text-gray-900 mb-4">音声設定</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    TTSエンジン
                  </label>
                  <select
                    value={settings.ttsEngine}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        ttsEngine: e.target.value as Settings['ttsEngine'],
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled
                  >
                    <option value="gemini_tts">gemini-2.5-pro-preview-tts</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    話速
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={settings.ttsSpeakingRate}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          ttsSpeakingRate: Number(e.target.value),
                        }))
                      }
                      className="flex-1"
                      disabled
                    />
                    <span className="text-sm text-gray-600 w-12 text-right">
                      {settings.ttsSpeakingRate.toFixed(1)}x
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Gemini TTS は現状「話速」の指定をサポートしていません
                  </p>
                </div>
              </div>
            </div>

            {/* その他設定 */}
            <div>
              <h3 className="text-base font-medium text-gray-900 mb-4">その他</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  自動保存間隔（秒）
                </label>
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={settings.autoSaveInterval}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoSaveInterval: Number(e.target.value),
                    }))
                  }
                  className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* 保存ボタン */}
            <div className="flex items-center gap-4 pt-4 border-t border-gray-200">
              <button
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSavingSettings ? '保存中...' : '設定を保存'}
              </button>
              {settingsSaved && (
                <span className="text-sm text-green-600">保存しました</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
