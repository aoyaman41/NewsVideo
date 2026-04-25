import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAutoSave } from '../hooks';
import { Header } from '../components/layout';
import { Badge, Button, Card, ErrorDetailPanel, StatusChip, useToast } from '../components/ui';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_PROMPT_TEXT_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  DEFAULT_SCRIPT_TEXT_MODEL,
  getDefaultGeminiThinkingLevel,
  getDefaultOpenAIReasoningEffort,
  getGeminiTtsModelLabel,
  getImageModelLabel,
  getSupportedGeminiThinkingLevels,
  getSupportedOpenAIReasoningEfforts,
  getTextCompletionModelLabel,
  GEMINI_TTS_MODELS,
  IMAGE_MODELS,
  IMAGE_RESOLUTION_LABELS,
  IMAGE_RESOLUTIONS,
  TEXT_COMPLETION_MODELS,
  type GeminiThinkingLevel,
  type GeminiTtsModel,
  type ImageModel,
  type ImageResolution,
  type OpenAITextCompletionModel,
  type OpenAIReasoningEffort,
  type SelectableOpenAIReasoningEffort,
  isGeminiTextCompletionModel,
  isOpenAITextCompletionModel,
  type TextCompletionModel,
} from '../../shared/constants/models';

type ApiKeyService = 'openai' | 'google_ai';

interface ConnectionStatus {
  success: boolean;
  message: string;
  latencyMs?: number;
}

interface VoiceInfo {
  name: string;
  languageCodes: string[];
  gender: 'MALE' | 'FEMALE' | 'NEUTRAL';
  sampleRateHertz: number;
}

interface Settings {
  ttsEngine: 'google_tts' | 'gemini_tts' | 'macos_tts';
  ttsModel: GeminiTtsModel;
  ttsVoice: string;
  ttsSpeakingRate: number;
  ttsPitch: number;
  scriptTextModel: TextCompletionModel;
  imagePromptTextModel: TextCompletionModel;
  openaiReasoningEffort: OpenAIReasoningEffort;
  geminiThinkingLevel: GeminiThinkingLevel;
  imageModel: ImageModel;
  imageResolution: ImageResolution;
  defaultAspectRatio: '16:9' | '1:1' | '9:16';
  videoResolution: '1920x1080' | '1280x720' | '3840x2160';
  videoFps: number;
  videoBitrate: string;
  audioBitrate: string;
  videoPartLeadInSec: number;
  openingVideoPath: string;
  endingVideoPath: string;
  defaultProjectDir: string;
}

const defaultSettings: Settings = {
  ttsEngine: 'gemini_tts',
  ttsModel: DEFAULT_GEMINI_TTS_MODEL,
  ttsVoice: 'Charon',
  ttsSpeakingRate: 1.0,
  ttsPitch: 0,
  scriptTextModel: DEFAULT_SCRIPT_TEXT_MODEL,
  imagePromptTextModel: DEFAULT_IMAGE_PROMPT_TEXT_MODEL,
  openaiReasoningEffort: getDefaultOpenAIReasoningEffort('gpt-5.2'),
  geminiThinkingLevel: getDefaultGeminiThinkingLevel('gemini-3.1-pro'),
  imageModel: DEFAULT_IMAGE_MODEL,
  imageResolution: DEFAULT_IMAGE_RESOLUTION,
  defaultAspectRatio: '16:9',
  videoResolution: '1920x1080',
  videoFps: 30,
  videoBitrate: '8M',
  audioBitrate: '192k',
  videoPartLeadInSec: 0.3,
  openingVideoPath: '',
  endingVideoPath: '',
  defaultProjectDir: '',
};

function formatOpenAIReasoningLabel(value: OpenAIReasoningEffort): string {
  const labels: Record<Exclude<OpenAIReasoningEffort, 'default'>, string> = {
    none: 'なし',
    minimal: '最小',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '最高',
  };
  return value === 'default' ? 'モデル既定値' : labels[value];
}

function formatGeminiThinkingLabel(value: GeminiThinkingLevel): string {
  const labels: Record<Exclude<GeminiThinkingLevel, 'default'>, string> = {
    low: '低',
    medium: '中',
    high: '高',
  };
  return value === 'default' ? 'モデル既定値' : labels[value];
}

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const returnTo = useMemo(() => {
    const state = location.state as { returnTo?: string } | null;
    if (!state || typeof state.returnTo !== 'string') return null;
    if (!state.returnTo || state.returnTo === '/settings') return null;
    return state.returnTo;
  }, [location.state]);

  const [apiKeys, setApiKeys] = useState<Record<ApiKeyService, string>>({
    openai: '',
    google_ai: '',
  });
  const [connectionStatus, setConnectionStatus] = useState<
    Record<ApiKeyService, ConnectionStatus | null>
  >({
    openai: null,
    google_ai: null,
  });
  const [isTesting, setIsTesting] = useState<Record<ApiKeyService, boolean>>({
    openai: false,
    google_ai: false,
  });
  const [isSaving, setIsSaving] = useState<Record<ApiKeyService, boolean>>({
    openai: false,
    google_ai: false,
  });
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [ttsVoices, setTtsVoices] = useState<VoiceInfo[]>([]);
  const [isLoadingTtsVoices, setIsLoadingTtsVoices] = useState(false);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'api' | 'video' | 'audio' | 'image'>('api');

  useEffect(() => {
    loadApiKeys();
    loadSettings();
  }, []);

  useEffect(() => {
    if (!hasLoadedSettings) return;

    let cancelled = false;
    const loadVoices = async () => {
      setIsLoadingTtsVoices(true);
      try {
        const list = await window.electronAPI.tts.getVoices(settings.ttsEngine);
        if (cancelled) return;
        setTtsVoices(list);
        setSettings((prev) => {
          if (list.length === 0) return prev;
          if (list.some((voice) => voice.name === prev.ttsVoice)) return prev;
          return { ...prev, ttsVoice: list[0].name };
        });
      } catch (error) {
        if (cancelled) return;
        console.warn('Failed to load TTS voices:', error);
        setTtsVoices([]);
      } finally {
        if (!cancelled) setIsLoadingTtsVoices(false);
      }
    };

    void loadVoices();

    return () => {
      cancelled = true;
    };
  }, [hasLoadedSettings, settings.ttsEngine]);

  const loadSettings = async () => {
    try {
      const loaded = await window.electronAPI.settings.get();
      setSettings({ ...defaultSettings, ...loaded });
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setHasLoadedSettings(true);
    }
  };

  const settingsAutoSave = useAutoSave({
    data: settings,
    enabled: hasLoadedSettings,
    interval: 1200,
    onSave: async (nextSettings) => {
      try {
        await window.electronAPI.settings.set(nextSettings);
        setSettingsSaveError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : '不明なエラー';
        setSettingsSaveError(message);
        throw error;
      }
    },
  });

  const settingsStatus = useMemo(() => {
    if (!hasLoadedSettings) {
      return { label: '読込中', tone: 'neutral' as const };
    }
    if (settingsSaveError) {
      return { label: '保存エラー', tone: 'danger' as const };
    }
    if (settingsAutoSave.isSaving) {
      return { label: '保存中', tone: 'info' as const };
    }
    if (settingsAutoSave.isDirty) {
      return { label: '変更あり', tone: 'warning' as const };
    }
    return { label: '保存済み', tone: 'success' as const };
  }, [hasLoadedSettings, settingsAutoSave.isDirty, settingsAutoSave.isSaving, settingsSaveError]);

  const loadApiKeys = async () => {
    const services: ApiKeyService[] = ['openai', 'google_ai'];
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
      setConnectionStatus((prev) => ({ ...prev, [service]: null }));
      toast.success(`${serviceLabels[service].name} のAPIキーを保存しました`);
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast.error(
        error instanceof Error ? error.message : '不明なエラー',
        `${serviceLabels[service].name} の保存に失敗しました`
      );
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
      if (result.success) {
        toast.success(result.message, `${serviceLabels[service].name} に接続できました`);
      } else {
        toast.error(result.message, `${serviceLabels[service].name} に接続できませんでした`);
      }
    } catch (error) {
      const nextStatus = {
        success: false,
        message: `エラー: ${error instanceof Error ? error.message : '不明'}`,
      };
      setConnectionStatus((prev) => ({
        ...prev,
        [service]: nextStatus,
      }));
      toast.error(nextStatus.message, `${serviceLabels[service].name} に接続できませんでした`);
    } finally {
      setIsTesting((prev) => ({ ...prev, [service]: false }));
    }
  };

  const serviceLabels: Record<ApiKeyService, { name: string; description: string; url: string }> = {
    openai: {
      name: 'OpenAI',
      description: 'OpenAI系の文章生成モデルと GPT Image 2 の画像生成に使用します',
      url: 'https://platform.openai.com/',
    },
    google_ai: {
      name: 'Google AI',
      description: 'Gemini系の文章生成、画像生成、Gemini TTS に使用します',
      url: 'https://aistudio.google.com/',
    },
  };

  const activeOpenAIModels = useMemo(() => {
    const models: OpenAITextCompletionModel[] = [];
    if (isOpenAITextCompletionModel(settings.scriptTextModel)) {
      models.push(settings.scriptTextModel);
    }
    if (
      isOpenAITextCompletionModel(settings.imagePromptTextModel) &&
      !models.includes(settings.imagePromptTextModel)
    ) {
      models.push(settings.imagePromptTextModel);
    }
    return models;
  }, [settings.imagePromptTextModel, settings.scriptTextModel]);

  const activeGeminiModel = useMemo(() => {
    if (isGeminiTextCompletionModel(settings.scriptTextModel)) return settings.scriptTextModel;
    if (isGeminiTextCompletionModel(settings.imagePromptTextModel)) return settings.imagePromptTextModel;
    return null;
  }, [settings.imagePromptTextModel, settings.scriptTextModel]);

  const openAIReasoningOptions = useMemo((): readonly SelectableOpenAIReasoningEffort[] => {
    if (activeOpenAIModels.length === 0) return [];
    const [firstModel, ...otherModels] = activeOpenAIModels;
    return getSupportedOpenAIReasoningEfforts(firstModel).filter((effort) =>
      otherModels.every((model) => getSupportedOpenAIReasoningEfforts(model).includes(effort))
    );
  }, [activeOpenAIModels]);

  useEffect(() => {
    setSettings((prev) => {
      let changed = false;
      const next = { ...prev };

      if (activeOpenAIModels.length > 0) {
        const effort = prev.openaiReasoningEffort as Exclude<OpenAIReasoningEffort, 'default'>;
        if (!openAIReasoningOptions.includes(effort)) {
          next.openaiReasoningEffort =
            openAIReasoningOptions[0] ?? getDefaultOpenAIReasoningEffort(activeOpenAIModels[0]);
          changed = true;
        }
      }

      if (activeGeminiModel) {
        const supported = getSupportedGeminiThinkingLevels(activeGeminiModel);
        if (!supported.includes(prev.geminiThinkingLevel as Exclude<GeminiThinkingLevel, 'default' | 'medium'>)) {
          next.geminiThinkingLevel = getDefaultGeminiThinkingLevel(activeGeminiModel);
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [activeGeminiModel, activeOpenAIModels, openAIReasoningOptions]);

  const scriptOpenAIReasoningOptions = isOpenAITextCompletionModel(settings.scriptTextModel)
    ? openAIReasoningOptions
    : [];
  const scriptGeminiThinkingOptions = isGeminiTextCompletionModel(settings.scriptTextModel)
    ? getSupportedGeminiThinkingLevels(settings.scriptTextModel)
    : [];
  const imageOpenAIReasoningOptions = isOpenAITextCompletionModel(settings.imagePromptTextModel)
    ? openAIReasoningOptions
    : [];
  const imageGeminiThinkingOptions = isGeminiTextCompletionModel(settings.imagePromptTextModel)
    ? getSupportedGeminiThinkingLevels(settings.imagePromptTextModel)
    : [];

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
        subtitle="変更は自動保存されます"
        statusLabel={settingsStatus.label}
        statusTone={settingsStatus.tone}
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
              { key: 'api', label: 'APIキー' },
              { key: 'video', label: '動画' },
              { key: 'audio', label: '音声' },
              { key: 'image', label: '画像' },
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
            <Card title="APIキー設定" subtitle="各サービスの接続状態を確認しながら保存">
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
            <>
              <Card title="スクリプト生成AI" subtitle="ナレーション原稿を作るモデル設定">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      スクリプト生成モデル
                    </label>
                    <select
                      value={settings.scriptTextModel}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          scriptTextModel: e.target.value as Settings['scriptTextModel'],
                        }))
                      }
                      className="nv-input"
                    >
                      {TEXT_COMPLETION_MODELS.map((model) => (
                        <option key={model} value={model}>
                          {getTextCompletionModelLabel(model)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                      モデルID: {settings.scriptTextModel}
                    </p>
                  </div>
                  {isOpenAITextCompletionModel(settings.scriptTextModel) ? (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        推論強度
                      </label>
                      <select
                        value={settings.openaiReasoningEffort}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            openaiReasoningEffort:
                              e.target.value as Settings['openaiReasoningEffort'],
                          }))
                        }
                        className="nv-input"
                      >
                        {scriptOpenAIReasoningOptions.map((effort) => (
                          <option key={effort} value={effort}>
                            {formatOpenAIReasoningLabel(effort)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
                        現在選択中のOpenAIモデルで共通して使える値だけを表示しています。
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        思考レベル
                      </label>
                      <select
                        value={settings.geminiThinkingLevel}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            geminiThinkingLevel: e.target.value as Settings['geminiThinkingLevel'],
                          }))
                        }
                        className="nv-input"
                      >
                        {scriptGeminiThinkingOptions.map((level) => (
                          <option key={level} value={level}>
                            {formatGeminiThinkingLabel(level)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
                        選択中の {getTextCompletionModelLabel(settings.scriptTextModel)} で使える値だけを表示しています。
                      </p>
                    </div>
                  )}
                </div>
              </Card>

              <Card title="デフォルト音声設定" subtitle="engine / model / voice の既定値">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      音声生成モデル
                    </label>
                    <select
                      value={settings.ttsModel}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          ttsModel: e.target.value as Settings['ttsModel'],
                        }))
                      }
                      className="nv-input"
                    >
                      {GEMINI_TTS_MODELS.map((model) => (
                        <option key={model} value={model}>
                          {getGeminiTtsModelLabel(model)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">モデルID: {settings.ttsModel}</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      ボイス
                    </label>
                    {ttsVoices.length > 0 ? (
                      <select
                        value={settings.ttsVoice}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, ttsVoice: e.target.value }))
                        }
                        className="nv-input"
                        disabled={isLoadingTtsVoices}
                      >
                        {ttsVoices.slice(0, 200).map((voice) => (
                          <option key={voice.name} value={voice.name}>
                            {voice.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={settings.ttsVoice}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, ttsVoice: e.target.value }))
                        }
                        className="nv-input"
                        placeholder={isLoadingTtsVoices ? '読み込み中...' : 'Charon'}
                      />
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      音声生成ページではここで設定した既定ボイスを使用します。
                    </p>
                  </div>
                  <div className="rounded-[10px] border border-[var(--nv-color-border)] bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-600">音声エンジン</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone="info">Gemini TTS</Badge>
                      <span className="text-sm font-semibold text-slate-900">gemini_tts</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      現在のアプリは Gemini TTS を既定の音声エンジンとして使用します。話し方の preset はプロジェクト設定側で切り替えます。
                    </p>
                  </div>
                  <div className="rounded-[10px] border border-[var(--nv-color-border)] bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-600">話速</p>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {settings.ttsSpeakingRate.toFixed(1)}x
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Gemini TTS では話速の個別調整 UI をまだ提供していないため、この値を表示のみとしています。
                    </p>
                  </div>
                </div>
              </Card>
            </>
          )}

          {activeTab === 'image' && (
            <>
              <Card title="画像プロンプト生成AI" subtitle="画像用の指示文を作るモデル設定">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      画像プロンプト生成モデル
                    </label>
                    <select
                      value={settings.imagePromptTextModel}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          imagePromptTextModel: e.target.value as Settings['imagePromptTextModel'],
                        }))
                      }
                      className="nv-input"
                    >
                      {TEXT_COMPLETION_MODELS.map((model) => (
                        <option key={model} value={model}>
                          {getTextCompletionModelLabel(model)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                      モデルID: {settings.imagePromptTextModel}
                    </p>
                  </div>
                  {isOpenAITextCompletionModel(settings.imagePromptTextModel) ? (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        推論強度
                      </label>
                      <select
                        value={settings.openaiReasoningEffort}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            openaiReasoningEffort:
                              e.target.value as Settings['openaiReasoningEffort'],
                          }))
                        }
                        className="nv-input"
                      >
                        {imageOpenAIReasoningOptions.map((effort) => (
                          <option key={effort} value={effort}>
                            {formatOpenAIReasoningLabel(effort)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
                        現在選択中のOpenAIモデルで共通して使える値だけを表示しています。
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        思考レベル
                      </label>
                      <select
                        value={settings.geminiThinkingLevel}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            geminiThinkingLevel: e.target.value as Settings['geminiThinkingLevel'],
                          }))
                        }
                        className="nv-input"
                      >
                        {imageGeminiThinkingOptions.map((level) => (
                          <option key={level} value={level}>
                            {formatGeminiThinkingLabel(level)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
                        選択中の {getTextCompletionModelLabel(settings.imagePromptTextModel)} で使える値だけを表示しています。
                      </p>
                    </div>
                  )}
                </div>
              </Card>

              <Card title="デフォルト画像設定" subtitle="画像生成モデルと解像度の選択">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      画像生成モデル
                    </label>
                    <select
                      value={settings.imageModel}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          imageModel: e.target.value as Settings['imageModel'],
                        }))
                      }
                      className="nv-input"
                    >
                      {IMAGE_MODELS.map((model) => (
                        <option key={model} value={model}>
                          {getImageModelLabel(model)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">モデルID: {settings.imageModel}</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      画像生成解像度
                    </label>
                    <select
                      value={settings.imageResolution}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          imageResolution: e.target.value as Settings['imageResolution'],
                        }))
                      }
                      className="nv-input"
                    >
                      {IMAGE_RESOLUTIONS.map((resolution) => (
                        <option key={resolution} value={resolution}>
                          {IMAGE_RESOLUTION_LABELS[resolution]}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                      GPT Image 2 では指定解像度を優先し、API制約に応じて近いサイズへ自動調整します。
                    </p>
                  </div>
                </div>
              </Card>
            </>
          )}

          {settingsSaveError && (
            <ErrorDetailPanel
              title="保存エラー"
              message={`設定の自動保存に失敗しました。変更内容は画面上に残っています。詳細: ${settingsSaveError}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
