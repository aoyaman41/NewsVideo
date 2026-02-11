import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from '../components/layout';
import { Badge, Button, Card, StatusChip } from '../components/ui';

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
  const [activeTab, setActiveTab] = useState<'api' | 'video' | 'audio' | 'other'>('api');

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
      const keyToTest = currentKey && currentKey !== '••••••••••••••••' ? currentKey : undefined;
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header
        title="設定"
        subtitle="APIキーとアプリケーション設定"
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              if (returnTo) {
                navigate(returnTo);
                return;
              }
              navigate('/projects');
            }}
          >
            戻る
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[var(--nv-color-border)] bg-white p-2">
            {[
              { key: 'api', label: 'API' },
              { key: 'video', label: '動画' },
              { key: 'audio', label: '音声' },
              { key: 'other', label: 'その他' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`rounded-[8px] px-3 py-2 text-sm font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[var(--nv-color-accent)] text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'api' && (
            <Card title="API設定" subtitle="各サービスの接続状態を確認しながら保存">
              <div className="space-y-4">
                {(Object.keys(serviceLabels) as ApiKeyService[]).map((service) => (
                  <div
                    key={service}
                    className="rounded-[8px] border border-[var(--nv-color-border)] p-4"
                  >
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {serviceLabels[service].name}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {serviceLabels[service].description}
                      </p>
                      <a
                        href={serviceLabels[service].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-[var(--nv-color-accent)] hover:underline"
                      >
                        APIキー取得ページ
                      </a>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <input
                        type="password"
                        value={apiKeys[service]}
                        onChange={(e) =>
                          setApiKeys((prev) => ({ ...prev, [service]: e.target.value }))
                        }
                        placeholder="APIキーを入力"
                        className="nv-input min-w-[260px] flex-1 font-mono text-sm"
                      />
                      <Button
                        onClick={() => handleSaveApiKey(service)}
                        disabled={
                          !apiKeys[service] ||
                          apiKeys[service] === '••••••••••••••••' ||
                          isSaving[service]
                        }
                      >
                        {isSaving[service] ? '保存中...' : '保存'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleTestConnection(service)}
                        disabled={isTesting[service]}
                      >
                        {isTesting[service] ? 'テスト中...' : '接続テスト'}
                      </Button>
                    </div>

                    {connectionStatus[service] && (
                      <div className="mt-3 rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 p-3 text-xs">
                        <div className="flex items-center gap-2">
                          <StatusChip
                            tone={connectionStatus[service]!.success ? 'success' : 'danger'}
                            label={connectionStatus[service]!.success ? '接続成功' : '接続失敗'}
                          />
                          {connectionStatus[service]!.latencyMs && (
                            <Badge tone="neutral">{connectionStatus[service]!.latencyMs}ms</Badge>
                          )}
                        </div>
                        <p className="mt-2 text-slate-600">{connectionStatus[service]!.message}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {activeTab === 'video' && (
            <Card title="デフォルト動画設定" subtitle="新規プロジェクトの初期値">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">解像度</label>
                  <select
                    value={settings.videoResolution}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        videoResolution: e.target.value as Settings['videoResolution'],
                      }))
                    }
                    className="nv-input"
                  >
                    <option value="1920x1080">1920x1080 (Full HD)</option>
                    <option value="1280x720">1280x720 (HD)</option>
                    <option value="3840x2160">3840x2160 (4K)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    フレームレート
                  </label>
                  <select
                    value={settings.videoFps}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, videoFps: Number(e.target.value) }))
                    }
                    className="nv-input"
                  >
                    <option value={24}>24 fps</option>
                    <option value={30}>30 fps</option>
                    <option value={60}>60 fps</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    動画ビットレート
                  </label>
                  <input
                    type="text"
                    value={settings.videoBitrate}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, videoBitrate: e.target.value }))
                    }
                    className="nv-input"
                    placeholder="8M"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    音声ビットレート
                  </label>
                  <input
                    type="text"
                    value={settings.audioBitrate}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, audioBitrate: e.target.value }))
                    }
                    className="nv-input"
                    placeholder="192k"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    読み上げ開始遅延（秒）
                  </label>
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
                    className="nv-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
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
                    className="nv-input"
                  >
                    <option value="16:9">16:9 (横長)</option>
                    <option value="9:16">9:16 (縦長)</option>
                    <option value="1:1">1:1 (正方形)</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    オープニング動画
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.openingVideoPath}
                      readOnly
                      placeholder="未設定"
                      className="nv-input flex-1 bg-slate-50"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => handleSelectVideoFile('openingVideoPath')}
                    >
                      参照
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setSettings((prev) => ({ ...prev, openingVideoPath: '' }))}
                      disabled={!settings.openingVideoPath}
                    >
                      クリア
                    </Button>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    エンディング動画
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.endingVideoPath}
                      readOnly
                      placeholder="未設定"
                      className="nv-input flex-1 bg-slate-50"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => handleSelectVideoFile('endingVideoPath')}
                    >
                      参照
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setSettings((prev) => ({ ...prev, endingVideoPath: '' }))}
                      disabled={!settings.endingVideoPath}
                    >
                      クリア
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {activeTab === 'audio' && (
            <Card title="デフォルト音声設定" subtitle="Gemini TTS の初期設定">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
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
                    className="nv-input"
                    disabled
                  >
                    <option value="gemini_tts">gemini-2.5-pro-preview-tts</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">話速</label>
                  <div className="flex items-center gap-2 rounded-[8px] border border-[var(--nv-color-border)] px-3 py-2">
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
                    <span className="w-12 text-right text-xs text-slate-600">
                      {settings.ttsSpeakingRate.toFixed(1)}x
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {activeTab === 'other' && (
            <Card title="その他" subtitle="運用系の設定">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    自動保存間隔（秒）
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="300"
                    value={settings.autoSaveInterval}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, autoSaveInterval: Number(e.target.value) }))
                    }
                    className="nv-input"
                  />
                </div>
              </div>
            </Card>
          )}

          <div className="nv-surface flex items-center justify-between gap-3 px-4 py-3">
            <div className="text-xs text-slate-500">設定変更後は保存してください。</div>
            <div className="flex items-center gap-2">
              {settingsSaved && <StatusChip tone="success" label="保存しました" />}
              <Button onClick={handleSaveSettings} disabled={isSavingSettings}>
                {isSavingSettings ? '保存中...' : '設定を保存'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
