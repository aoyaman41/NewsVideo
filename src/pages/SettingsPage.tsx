import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAutoSave } from '../hooks';
import { Header } from '../components/layout';
import { Button, Card, ErrorDetailPanel, useToast } from '../components/ui';
import { ApiKeyList } from '../components/onboarding/ApiKeyList';
import { API_KEY_SERVICE_INFO, type ApiKeyService } from '../components/onboarding/apiKeys';
import { useApiKeyStatus } from '../components/onboarding/useApiKeyStatus';
import { ReadingDictionaryEditor } from '../components/settings/ReadingDictionaryEditor';
import {
  readSettingsLocationState,
  type SettingsSection,
} from '../components/settings/settingsNavigation';
import { useGenerationPreferences } from '../stores/generationPreferences';
import { cx } from '../utils/cx';
import { normalizeSettings, type AppSettings } from '../../shared/settings/appSettings';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  DEFAULT_SCRIPT_TEXT_MODEL,
  getCommonSupportedOpenAIReasoningEfforts,
  getDefaultClaudeEffort,
  getDefaultGeminiThinkingLevel,
  getDefaultOpenAIReasoningEffort,
  getGeminiTtsModelLabel,
  getImageModelLabel,
  getImageModelProvider,
  getSupportedClaudeEfforts,
  getSupportedGeminiThinkingLevels,
  getTextCompletionModelLabel,
  getTextCompletionModelProvider,
  IMAGE_RESOLUTION_LABELS,
  IMAGE_RESOLUTIONS,
  SELECTABLE_GEMINI_TTS_MODELS,
  SELECTABLE_IMAGE_MODELS,
  SELECTABLE_TEXT_COMPLETION_MODELS,
  type ClaudeEffort,
  type GeminiThinkingLevel,
  type OpenAITextCompletionModel,
  type OpenAIReasoningEffort,
  type SelectableClaudeEffort,
  type SelectableOpenAIReasoningEffort,
  isAnthropicTextCompletionModel,
  isGeminiImageModel,
  isGeminiTextCompletionModel,
  isOpenAITextCompletionModel,
  type TextCompletionModel,
} from '../../shared/constants/models';

type Settings = AppSettings;

interface VoiceInfo {
  name: string;
  languageCodes: string[];
  gender: 'MALE' | 'FEMALE' | 'NEUTRAL';
  sampleRateHertz: number;
}

const SECTIONS: Array<{ key: SettingsSection; label: string }> = [
  { key: 'api', label: 'API キー' },
  { key: 'models', label: '生成モデル' },
  { key: 'video', label: '動画' },
  { key: 'dictionary', label: '読み辞書' },
  { key: 'advanced', label: '詳細設定' },
];

const fieldLabel = 'mb-1 block text-xs font-semibold text-[var(--nv-color-muted)]';
const fieldHint = 'mt-1 text-xs text-[var(--nv-color-muted)]';

function formatOpenAIReasoningLabel(value: OpenAIReasoningEffort): string {
  const labels: Record<Exclude<OpenAIReasoningEffort, 'default'>, string> = {
    none: 'なし',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '非常に高い',
    max: '最大',
  };
  return value === 'default' ? 'モデル既定値' : labels[value];
}

function getTextCompletionModelDescription(model: TextCompletionModel): string | null {
  const descriptions: Partial<Record<TextCompletionModel, string>> = {
    'gpt-5.6-sol': '最高品質。複雑な構成や品質重視の生成に向いています。',
    'gpt-5.6-terra': '品質とコストのバランスを重視する標準的な生成に向いています。',
    'gpt-5.6-luna': '速度とコストを重視する大量生成に向いています。',
  };
  return descriptions[model] ?? null;
}

function formatGeminiThinkingLabel(value: GeminiThinkingLevel): string {
  const labels: Record<Exclude<GeminiThinkingLevel, 'default'>, string> = {
    low: '低',
    medium: '中',
    high: '高',
  };
  return value === 'default' ? 'モデル既定値' : labels[value];
}

// 選択肢から外した旧モデルが保存されている場合は、その値も末尾に残して表示する(保存値は変えない)
function withSavedOption<T extends string>(options: readonly T[], saved: T): readonly T[] {
  return options.includes(saved) ? options : [...options, saved];
}

function modelOptionLabel(label: string, isSelectable: boolean, isDefault: boolean): string {
  if (!isSelectable) return `${label}(旧モデル)`;
  return isDefault ? `${label}(おすすめ)` : label;
}

function formatClaudeEffortLabel(value: ClaudeEffort): string {
  const labels: Record<SelectableClaudeEffort, string> = {
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '非常に高い',
    max: '最大',
  };
  return value === 'default' ? 'モデル既定値' : labels[value];
}

function textModelService(model: TextCompletionModel): ApiKeyService {
  const provider = getTextCompletionModelProvider(model);
  return provider === 'gemini' ? 'google_ai' : provider;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/** 生成モデルの区分ごとに、使う API キーと未設定の案内を出す */
function KeyNote({
  service,
  saved,
  onOpenKeys,
}: {
  service: ApiKeyService;
  saved: boolean | null;
  onOpenKeys: () => void;
}) {
  const name = API_KEY_SERVICE_INFO[service].name;
  if (saved === false)
    return (
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--nv-color-warning)]">
        {name} の API キーが未設定です。
        <button
          type="button"
          onClick={onOpenKeys}
          className="nv-focus-ring rounded-[var(--nv-radius-sm)] font-semibold text-[var(--nv-color-accent)] underline"
        >
          API キーを設定する
        </button>
      </p>
    );
  return <p className={fieldHint}>{name} の API キーを使います。</p>;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-[var(--nv-color-muted)]">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { returnTo, section: requestedSection } = useMemo(
    () => readSettingsLocationState(location.state),
    [location.state]
  );

  const { status: keyStatus, markSaved } = useApiKeyStatus();
  const [preferences, setPreferences] = useGenerationPreferences();
  const [settings, setSettings] = useState<Settings>(() => normalizeSettings({}));
  const [ttsVoices, setTtsVoices] = useState<VoiceInfo[]>([]);
  const [isLoadingTtsVoices, setIsLoadingTtsVoices] = useState(false);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>(requestedSection ?? 'api');
  const [shownRequest, setShownRequest] = useState(location.key);

  // 別の画面から区分を指定して開き直されたときは、その区分に切り替える
  if (shownRequest !== location.key) {
    setShownRequest(location.key);
    if (requestedSection) setActiveSection(requestedSection);
  }

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const loaded = await window.electronAPI.settings.get();
        if (active) setSettings(normalizeSettings(loaded));
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        if (active) setHasLoadedSettings(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
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

  const settingsAutoSave = useAutoSave({
    data: settings,
    enabled: hasLoadedSettings,
    interval: 1200,
    onSave: async (nextSettings) => {
      try {
        // 料金表(cost)はこの画面では編集しないので送らない(保存済みの値を Main 側で残す)
        const payload: Partial<Settings> = { ...nextSettings };
        delete payload.cost;
        await window.electronAPI.settings.set(
          payload as Parameters<typeof window.electronAPI.settings.set>[0]
        );
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
      return { label: '読み込み中', tone: 'neutral' as const };
    }
    if (settingsSaveError) {
      return { label: '保存できませんでした', tone: 'danger' as const };
    }
    if (settingsAutoSave.isSaving || settingsAutoSave.isDirty) {
      return { label: '保存中', tone: 'info' as const };
    }
    return { label: '保存済み', tone: 'success' as const };
  }, [hasLoadedSettings, settingsAutoSave.isDirty, settingsAutoSave.isSaving, settingsSaveError]);

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
    if (isGeminiTextCompletionModel(settings.imagePromptTextModel))
      return settings.imagePromptTextModel;
    return null;
  }, [settings.imagePromptTextModel, settings.scriptTextModel]);

  const scriptAnthropicModel = isAnthropicTextCompletionModel(settings.scriptTextModel)
    ? settings.scriptTextModel
    : null;
  const imagePromptAnthropicModel = isAnthropicTextCompletionModel(settings.imagePromptTextModel)
    ? settings.imagePromptTextModel
    : null;

  const openAIReasoningOptions = useMemo((): readonly SelectableOpenAIReasoningEffort[] => {
    return getCommonSupportedOpenAIReasoningEfforts(activeOpenAIModels);
  }, [activeOpenAIModels]);

  // モデルを変えたときに、そのモデルで使えない「思考の深さ」を既定値へ戻す
  useEffect(() => {
    setSettings((prev) => {
      let changed = false;
      const next = { ...prev };

      if (activeOpenAIModels.length > 0) {
        const effort = prev.openaiReasoningEffort as Exclude<OpenAIReasoningEffort, 'default'>;
        if (!openAIReasoningOptions.includes(effort)) {
          const selectedModelDefault = getDefaultOpenAIReasoningEffort(activeOpenAIModels[0]);
          next.openaiReasoningEffort = openAIReasoningOptions.includes(selectedModelDefault)
            ? selectedModelDefault
            : (openAIReasoningOptions[0] ?? selectedModelDefault);
          changed = true;
        }
      }

      if (activeGeminiModel) {
        const supported = getSupportedGeminiThinkingLevels(activeGeminiModel);
        if (
          !supported.includes(prev.geminiThinkingLevel as Exclude<GeminiThinkingLevel, 'default'>)
        ) {
          next.geminiThinkingLevel = getDefaultGeminiThinkingLevel(activeGeminiModel);
          changed = true;
        }
      }

      // Claude の effort は台本用(claudeEffort)と画像プロンプト用(claudeImagePromptEffort)で別々に持つ
      if (scriptAnthropicModel) {
        const supported = getSupportedClaudeEfforts(scriptAnthropicModel);
        if (!supported.includes(prev.claudeEffort as SelectableClaudeEffort)) {
          next.claudeEffort = getDefaultClaudeEffort(scriptAnthropicModel);
          changed = true;
        }
      }

      if (imagePromptAnthropicModel) {
        const supported = getSupportedClaudeEfforts(imagePromptAnthropicModel);
        if (!supported.includes(prev.claudeImagePromptEffort as SelectableClaudeEffort)) {
          next.claudeImagePromptEffort = getDefaultClaudeEffort(imagePromptAnthropicModel);
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [
    activeGeminiModel,
    activeOpenAIModels,
    imagePromptAnthropicModel,
    openAIReasoningOptions,
    scriptAnthropicModel,
  ]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSelectVideoFile = async (field: 'openingVideoPath' | 'endingVideoPath') => {
    try {
      const selected = await window.electronAPI.file.selectFile({
        title: field === 'openingVideoPath' ? '最初に流す動画を選択' : '最後に流す動画を選択',
        filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v'] }],
        properties: ['openFile'],
      });
      if (!selected) return;
      update(field, selected);
    } catch (error) {
      console.error('Failed to select video file:', error);
    }
  };

  const textModelsDiffer = settings.scriptTextModel !== settings.imagePromptTextModel;
  const openKeys = () => setActiveSection('api');

  const selectSection = (key: SettingsSection) => setActiveSection(key);
  const handleTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = SECTIONS.findIndex((item) => item.key === activeSection);
    const next =
      SECTIONS[(index + (event.key === 'ArrowRight' ? 1 : -1) + SECTIONS.length) % SECTIONS.length];
    setActiveSection(next.key);
    document.getElementById(`settings-tab-${next.key}`)?.focus();
  };

  const textModelSelect = (
    id: string,
    value: TextCompletionModel,
    onChange: (model: TextCompletionModel) => void
  ) => (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as TextCompletionModel)}
      className="nv-input"
    >
      {withSavedOption(SELECTABLE_TEXT_COMPLETION_MODELS, value).map((model) => (
        <option key={model} value={model}>
          {modelOptionLabel(
            getTextCompletionModelLabel(model),
            SELECTABLE_TEXT_COMPLETION_MODELS.includes(model),
            model === DEFAULT_SCRIPT_TEXT_MODEL
          )}
        </option>
      ))}
    </select>
  );

  const effortControl = (purpose: 'script' | 'image') => {
    const model = purpose === 'script' ? settings.scriptTextModel : settings.imagePromptTextModel;
    const id = `settings-effort-${purpose}`;
    if (isOpenAITextCompletionModel(model)) {
      return (
        <div>
          <label htmlFor={id} className={fieldLabel}>
            {purpose === 'script' ? '台本' : '画像の指示'}の推論の強さ
          </label>
          <select
            id={id}
            value={settings.openaiReasoningEffort}
            onChange={(e) =>
              update('openaiReasoningEffort', e.target.value as Settings['openaiReasoningEffort'])
            }
            className="nv-input"
          >
            {openAIReasoningOptions.map((effort) => (
              <option key={effort} value={effort}>
                {formatOpenAIReasoningLabel(effort)}
              </option>
            ))}
          </select>
          <p className={fieldHint}>OpenAI のモデルでは台本と画像の指示で共通の値です。</p>
        </div>
      );
    }
    if (isAnthropicTextCompletionModel(model)) {
      const key = purpose === 'script' ? 'claudeEffort' : 'claudeImagePromptEffort';
      return (
        <div>
          <label htmlFor={id} className={fieldLabel}>
            {purpose === 'script' ? '台本' : '画像の指示'}の思考の深さ
          </label>
          <select
            id={id}
            value={settings[key]}
            onChange={(e) => update(key, e.target.value as ClaudeEffort)}
            className="nv-input"
          >
            {getSupportedClaudeEfforts(model).map((effort) => (
              <option key={effort} value={effort}>
                {formatClaudeEffortLabel(effort)}
                {effort === getDefaultClaudeEffort(model) ? '(既定)' : ''}
              </option>
            ))}
          </select>
          <p className={fieldHint}>高いほど品質が上がり、時間と費用が増えます。</p>
        </div>
      );
    }
    return (
      <div>
        <label htmlFor={id} className={fieldLabel}>
          {purpose === 'script' ? '台本' : '画像の指示'}の思考レベル
        </label>
        <select
          id={id}
          value={settings.geminiThinkingLevel}
          onChange={(e) =>
            update('geminiThinkingLevel', e.target.value as Settings['geminiThinkingLevel'])
          }
          className="nv-input"
        >
          {(isGeminiTextCompletionModel(model) ? getSupportedGeminiThinkingLevels(model) : []).map(
            (level) => (
              <option key={level} value={level}>
                {formatGeminiThinkingLabel(level)}
              </option>
            )
          )}
        </select>
        <p className={fieldHint}>Gemini のモデルでは台本と画像の指示で共通の値です。</p>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header
        title="設定"
        subtitle="変更は自動で保存されます"
        statusLabel={settingsStatus.label}
        statusTone={settingsStatus.tone}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              navigate(returnTo ?? '/projects');
            }}
          >
            戻る
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div
            role="tablist"
            aria-label="設定の区分"
            onKeyDown={handleTabKey}
            className="flex flex-wrap items-center gap-1 rounded-[var(--nv-radius-md)] border border-[var(--nv-color-border)] bg-[var(--nv-color-surface)] p-1"
          >
            {SECTIONS.map((item) => (
              <button
                key={item.key}
                id={`settings-tab-${item.key}`}
                type="button"
                role="tab"
                aria-selected={activeSection === item.key}
                aria-controls={`settings-panel-${item.key}`}
                tabIndex={activeSection === item.key ? 0 : -1}
                onClick={() => selectSection(item.key)}
                className={cx(
                  'nv-focus-ring rounded-[var(--nv-radius-sm)] px-3 py-2 text-sm font-semibold transition-colors duration-[var(--nv-duration-fast)]',
                  activeSection === item.key
                    ? 'bg-[var(--nv-color-accent)] text-white'
                    : 'text-[var(--nv-color-muted)] hover:bg-[var(--nv-color-canvas)]'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {settingsSaveError && (
            <ErrorDetailPanel
              title="保存できませんでした"
              message={`設定を自動で保存できませんでした。変更内容は画面に残っています。詳しい内容: ${settingsSaveError}`}
            />
          )}

          <div
            role="tabpanel"
            id={`settings-panel-${activeSection}`}
            aria-labelledby={`settings-tab-${activeSection}`}
          >
            {activeSection === 'api' && (
              <Card
                title="API キー"
                subtitle="AI サービスを使うための鍵です。キーはこの Mac の中に暗号化して保存します。"
                actions={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate('/welcome', { state: { returnTo: '/settings' } })}
                  >
                    はじめの案内を開く
                  </Button>
                }
              >
                <ApiKeyList status={keyStatus} settings={settings} onSaved={markSaved} />
              </Card>
            )}

            {activeSection === 'models' && (
              <Card
                title="生成モデル"
                subtitle="用途ごとに使う AI を選びます。次に作るものから使われます。"
              >
                <div className="space-y-6">
                  <Section
                    title="文章(台本と画像の指示)"
                    description="記事から台本を書き、各シーンの画像の指示を作ります。"
                  >
                    <div>
                      <label htmlFor="settings-text-model" className={fieldLabel}>
                        文章を作るモデル
                      </label>
                      {textModelSelect('settings-text-model', settings.scriptTextModel, (model) =>
                        setSettings((prev) => ({
                          ...prev,
                          scriptTextModel: model,
                          imagePromptTextModel: model,
                        }))
                      )}
                      {getTextCompletionModelDescription(settings.scriptTextModel) && (
                        <p className={fieldHint}>
                          {getTextCompletionModelDescription(settings.scriptTextModel)}
                        </p>
                      )}
                      {textModelsDiffer && (
                        <p className={fieldHint}>
                          画像の指示には{' '}
                          {getTextCompletionModelLabel(settings.imagePromptTextModel)}{' '}
                          を使っています(別々に選ぶときは「詳細設定」で変えられます)。
                        </p>
                      )}
                      <KeyNote
                        service={textModelService(settings.scriptTextModel)}
                        saved={keyStatus[textModelService(settings.scriptTextModel)]}
                        onOpenKeys={openKeys}
                      />
                    </div>
                  </Section>

                  <Section title="画像" description="各シーンの画像を作ります。">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label htmlFor="settings-image-model" className={fieldLabel}>
                          画像を作るモデル
                        </label>
                        <select
                          id="settings-image-model"
                          value={settings.imageModel}
                          onChange={(e) =>
                            update('imageModel', e.target.value as Settings['imageModel'])
                          }
                          className="nv-input"
                        >
                          {withSavedOption(SELECTABLE_IMAGE_MODELS, settings.imageModel).map(
                            (model) => (
                              <option key={model} value={model}>
                                {modelOptionLabel(
                                  getImageModelLabel(model),
                                  SELECTABLE_IMAGE_MODELS.includes(model),
                                  model === DEFAULT_IMAGE_MODEL
                                )}
                              </option>
                            )
                          )}
                        </select>
                        <KeyNote
                          service={
                            getImageModelProvider(settings.imageModel) === 'openai'
                              ? 'openai'
                              : 'google_ai'
                          }
                          saved={
                            keyStatus[
                              getImageModelProvider(settings.imageModel) === 'openai'
                                ? 'openai'
                                : 'google_ai'
                            ]
                          }
                          onOpenKeys={openKeys}
                        />
                      </div>
                      <div>
                        <label htmlFor="settings-image-resolution" className={fieldLabel}>
                          画像の大きさ
                        </label>
                        <select
                          id="settings-image-resolution"
                          value={settings.imageResolution}
                          onChange={(e) =>
                            update('imageResolution', e.target.value as Settings['imageResolution'])
                          }
                          className="nv-input"
                        >
                          {IMAGE_RESOLUTIONS.map((resolution) => (
                            <option key={resolution} value={resolution}>
                              {IMAGE_RESOLUTION_LABELS[resolution]}
                              {resolution === DEFAULT_IMAGE_RESOLUTION ? '(おすすめ)' : ''}
                            </option>
                          ))}
                        </select>
                        <p className={fieldHint}>
                          大きいほど細部がきれいになり、時間と費用が増えます。
                          {isGeminiImageModel(settings.imageModel) &&
                          settings.imageResolution === 'fhd'
                            ? 'このモデルでは、文字を読みやすくするため 2K で作ります。'
                            : ''}
                        </p>
                      </div>
                    </div>
                  </Section>

                  <Section title="音声" description="台本を読み上げるナレーションを作ります。">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label htmlFor="settings-voice-model" className={fieldLabel}>
                          音声を作るモデル
                        </label>
                        <select
                          id="settings-voice-model"
                          value={settings.ttsModel}
                          onChange={(e) =>
                            update('ttsModel', e.target.value as Settings['ttsModel'])
                          }
                          className="nv-input"
                        >
                          {withSavedOption(SELECTABLE_GEMINI_TTS_MODELS, settings.ttsModel).map(
                            (model) => (
                              <option key={model} value={model}>
                                {modelOptionLabel(
                                  getGeminiTtsModelLabel(model),
                                  SELECTABLE_GEMINI_TTS_MODELS.includes(model),
                                  model === DEFAULT_GEMINI_TTS_MODEL
                                )}
                              </option>
                            )
                          )}
                        </select>
                        <KeyNote
                          service="google_ai"
                          saved={keyStatus.google_ai}
                          onOpenKeys={openKeys}
                        />
                      </div>
                      <div>
                        <label htmlFor="settings-voice" className={fieldLabel}>
                          声
                        </label>
                        {ttsVoices.length > 0 ? (
                          <select
                            id="settings-voice"
                            value={settings.ttsVoice}
                            onChange={(e) => update('ttsVoice', e.target.value)}
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
                            id="settings-voice"
                            type="text"
                            value={settings.ttsVoice}
                            onChange={(e) => update('ttsVoice', e.target.value)}
                            className="nv-input"
                            placeholder={isLoadingTtsVoices ? '読み込み中…' : 'Charon'}
                          />
                        )}
                        <p className={fieldHint}>
                          話し方(ニュース調など)は記事画面の詳細設定で選べます。
                        </p>
                      </div>
                    </div>
                  </Section>
                </div>
              </Card>
            )}

            {activeSection === 'video' && (
              <Card title="動画" subtitle="新しく作る動画の既定値です。">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="settings-video-resolution" className={fieldLabel}>
                      動画の大きさ
                    </label>
                    <select
                      id="settings-video-resolution"
                      value={settings.videoResolution}
                      onChange={(e) =>
                        update('videoResolution', e.target.value as Settings['videoResolution'])
                      }
                      className="nv-input"
                    >
                      <option value="1920x1080">フル HD(1920×1080・おすすめ)</option>
                      <option value="1280x720">HD(1280×720・軽い)</option>
                      <option value="3840x2160">4K(3840×2160・時間がかかります)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="settings-aspect" className={fieldLabel}>
                      画面の縦横(新しいプロジェクト)
                    </label>
                    <select
                      id="settings-aspect"
                      value={settings.defaultAspectRatio}
                      onChange={(e) =>
                        update(
                          'defaultAspectRatio',
                          e.target.value as Settings['defaultAspectRatio']
                        )
                      }
                      className="nv-input"
                    >
                      <option value="16:9">16:9(横長)</option>
                      <option value="9:16">9:16(縦長)</option>
                      <option value="1:1">1:1(正方形)</option>
                    </select>
                  </div>
                  {(['openingVideoPath', 'endingVideoPath'] as const).map((field) => (
                    <div key={field} className="md:col-span-2">
                      <p className={fieldLabel}>
                        {field === 'openingVideoPath'
                          ? '最初に流す動画(任意)'
                          : '最後に流す動画(任意)'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="min-w-0 flex-1 truncate text-sm text-[var(--nv-color-text)]"
                          title={settings[field] || undefined}
                        >
                          {settings[field] ? fileName(settings[field]) : '未設定'}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleSelectVideoFile(field)}
                        >
                          選ぶ
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => update(field, '')}
                          disabled={!settings[field]}
                        >
                          外す
                        </Button>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-[var(--nv-color-muted)] md:col-span-2">
                    最初と最後に流す動画は、動画画面で使うかどうかを切り替えられます。フレームレートなどの細かい設定は「詳細設定」にあります。
                  </p>
                </div>
              </Card>
            )}

            {activeSection === 'dictionary' && (
              <Card
                title="読み辞書"
                subtitle="ナレーションで読み間違える言葉の読みを登録します。すべてのプロジェクトで使われます。"
              >
                {hasLoadedSettings ? (
                  <div className="space-y-3">
                    <ReadingDictionaryEditor
                      entries={settings.readingDictionary}
                      onCommit={(readingDictionary) =>
                        setSettings((prev) => ({ ...prev, readingDictionary }))
                      }
                    />
                    <p className="text-xs text-[var(--nv-color-muted)]">
                      登録した読みは、このあと作る音声から使われます。作成済みの音声は、音声画面で作り直すと反映されます。
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--nv-color-muted)]">読み込み中…</p>
                )}
              </Card>
            )}

            {activeSection === 'advanced' && (
              <Card title="詳細設定" subtitle="ふだんは変える必要はありません。">
                <div className="space-y-6">
                  <Section title="自動生成">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label htmlFor="settings-mode" className={fieldLabel}>
                          進め方
                        </label>
                        <select
                          id="settings-mode"
                          value={preferences.mode}
                          onChange={(e) =>
                            setPreferences({
                              mode: e.target.value === 'review' ? 'review' : 'automatic',
                            })
                          }
                          className="nv-input"
                        >
                          <option value="automatic">最後まで自動で進める(おすすめ)</option>
                          <option value="review">台本と素材ができたところで止めて確認する</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="settings-budget" className={fieldLabel}>
                          1 回の予算の上限(USD)
                        </label>
                        <input
                          id="settings-budget"
                          type="number"
                          min="0"
                          step="0.1"
                          value={preferences.budgetUsd}
                          onChange={(e) => setPreferences({ budgetUsd: e.target.value })}
                          className="nv-input w-32"
                          placeholder="上限なし"
                        />
                        <p className={fieldHint}>
                          空欄なら上限なし。見積もりをもとに判断するため、実際の料金を厳密に上限に抑えるものではありません。
                        </p>
                      </div>
                    </div>
                  </Section>

                  <Section
                    title="文章のモデル(用途別)"
                    description="台本と画像の指示で別のモデルを使うときに設定します。"
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label htmlFor="settings-script-model" className={fieldLabel}>
                          台本のモデル
                        </label>
                        {textModelSelect(
                          'settings-script-model',
                          settings.scriptTextModel,
                          (model) => update('scriptTextModel', model)
                        )}
                      </div>
                      <div>
                        <label htmlFor="settings-image-prompt-model" className={fieldLabel}>
                          画像の指示のモデル
                        </label>
                        {textModelSelect(
                          'settings-image-prompt-model',
                          settings.imagePromptTextModel,
                          (model) => update('imagePromptTextModel', model)
                        )}
                      </div>
                      {effortControl('script')}
                      {effortControl('image')}
                    </div>
                  </Section>

                  <Section
                    title="同時に処理する数"
                    description="1 つのサービスに同時に送る数です。多いほど速くなりますが、利用上限に達しやすくなります。"
                  >
                    <select
                      aria-label="同時に処理する数"
                      className="nv-input w-32"
                      value={settings.generationConcurrency}
                      onChange={(event) =>
                        update('generationConcurrency', Number(event.target.value))
                      }
                    >
                      {[1, 2, 3, 4].map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </Section>

                  <Section title="動画の書き出し">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label htmlFor="settings-fps" className={fieldLabel}>
                          フレームレート(fps)
                        </label>
                        <select
                          id="settings-fps"
                          value={settings.videoFps}
                          onChange={(e) => update('videoFps', Number(e.target.value))}
                          className="nv-input"
                        >
                          <option value={24}>24 fps</option>
                          <option value={30}>30 fps(おすすめ)</option>
                          <option value={60}>60 fps</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="settings-lead-in" className={fieldLabel}>
                          シーンの読み上げ前の間(秒)
                        </label>
                        <input
                          id="settings-lead-in"
                          type="number"
                          min="0"
                          max="2"
                          step="0.05"
                          value={settings.videoPartLeadInSec}
                          onChange={(e) =>
                            update(
                              'videoPartLeadInSec',
                              Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0
                            )
                          }
                          className="nv-input w-32"
                        />
                      </div>
                      <div>
                        <label htmlFor="settings-video-bitrate" className={fieldLabel}>
                          映像のビットレート
                        </label>
                        <input
                          id="settings-video-bitrate"
                          type="text"
                          value={settings.videoBitrate}
                          onChange={(e) => update('videoBitrate', e.target.value)}
                          className="nv-input w-32"
                          placeholder="8M"
                        />
                      </div>
                      <div>
                        <label htmlFor="settings-audio-bitrate" className={fieldLabel}>
                          音声のビットレート
                        </label>
                        <input
                          id="settings-audio-bitrate"
                          type="text"
                          value={settings.audioBitrate}
                          onChange={(e) => update('audioBitrate', e.target.value)}
                          className="nv-input w-32"
                          placeholder="192k"
                        />
                      </div>
                    </div>
                  </Section>

                  <Section
                    title="サポート"
                    description="不具合を報告するときに使う診断ファイルを保存します。記事本文・画像・API キー・ファイルの場所は含みません。自動では送信しません。"
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          const file = await window.electronAPI.diagnostics.export();
                          if (file) toast.success('診断ファイルを保存しました');
                        } catch (error) {
                          toast.error(String(error), '診断ファイルを保存できませんでした');
                        }
                      }}
                    >
                      診断ファイルを保存
                    </Button>
                  </Section>
                </div>
              </Card>
            )}
          </div>

          <p className="text-xs text-[var(--nv-color-muted)]">
            実行中や「続きから」で再開する自動生成は、開始したときの設定で進みます。
          </p>
        </div>
      </div>
    </div>
  );
}
