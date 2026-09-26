import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ArticleInput, ImageDropzone } from '../components/article';
import type { ArticleAction } from '../components/article/ArticleInput';
import { GenerationQuote } from '../components/article/GenerationQuote';
import { FriendlyError } from '../components/errors/FriendlyError';
import { BUDGET_STAGE, isJobActive, isJobResumable } from '../components/job/jobDisplay';
import { API_KEY_SERVICE_INFO, requiredServices } from '../components/onboarding/apiKeys';
import { useApiKeyStatus } from '../components/onboarding/useApiKeyStatus';
import { useOpenSettings } from '../components/settings/settingsNavigation';
import { Button, Details, useConfirm, useToast } from '../components/ui';
import {
  budgetToUsd,
  ensureGenerationPreferencesMigrated,
  preferencesFromSettings,
  preferencesToSettings,
  saveGenerationPreferences,
  type GenerationPreferences,
} from '../stores/generationPreferences';
import { useJobFeed } from '../stores/jobStore';
import { projectClient, useProjectState } from '../stores/projectStore';
import type {
  ArticleInput as ArticleInputType,
  ImageAsset,
  PresentationProfile,
  Project,
} from '../schemas';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../../shared/settings/appSettings';
import {
  PRESENTATION_PROFILE_PRESET_DESCRIPTIONS,
  PRESENTATION_PROFILE_PRESET_LABELS,
  PRESENTATION_PROFILE_PRESETS,
  getDefaultPresentationProfile,
  normalizePresentationProfile,
  resolvePresentationClosingLine,
  type PresentationProfilePreset,
} from '../../shared/project/presentationProfile';
import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_ASPECT_RATIO_LABELS,
  IMAGE_STYLE_PRESETS,
  IMAGE_STYLE_PRESET_DESCRIPTIONS,
  IMAGE_STYLE_PRESET_LABELS,
} from '../../shared/project/imageStylePresets';
import {
  TTS_NARRATION_STYLE_DESCRIPTIONS,
  TTS_NARRATION_STYLE_LABELS,
  TTS_NARRATION_STYLE_PRESETS,
} from '../../shared/project/ttsNarrationStyles';

const CLOSING_LINE_LABELS: Record<PresentationProfile['closingLineMode'], string> = {
  preset: '用途に合わせた定型文',
  none: '入れない',
  custom: '自分で入力する',
};

// 見た目は M4-B の共通クラス(src/styles/utilities.css の .nv-label / .nv-help)にそろえる
const fieldLabel = 'nv-label';
const fieldHint = 'nv-help mt-1';

/** 画面に出すエラーと、何に失敗したか */
type PageError = { error: unknown; title: string };

export function ArticleInputPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const toast = useToast();
  const { confirm } = useConfirm();
  const openSettings = useOpenSettings();

  const [project, setProject] = useProjectState(projectId);
  const [formDefaults, setFormDefaults] = useState<Partial<ArticleInputType>>({
    title: '',
    source: '',
    bodyText: '',
  });
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<PageError | null>(null);
  const [targetPartCount, setTargetPartCount] = useState<number>(5);
  const [presentationProfile, setPresentationProfile] = useState<PresentationProfile>(
    getDefaultPresentationProfile()
  );
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // 止まっているジョブがあるときは、そのジョブの進め方と予算を初期値にする(「続きから」で使う値を画面に出す)
  const [runOptions, setRunOptions] = useState<GenerationPreferences | null>(null);
  const { status: keyStatus, loaded: keysLoaded, refresh: refreshKeys } = useApiKeyStatus();
  const trackedJob = useJobFeed().jobs.get(projectId ?? '')?.job;
  const job = trackedJob ?? project?.job;

  const isMountedRef = useRef(true);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  const savedPresentationProfileRef = useRef<string>(
    JSON.stringify(getDefaultPresentationProfile())
  );

  const reportError = useCallback((value: unknown, title: string) => {
    if (isMountedRef.current) setError({ error: value, title });
  }, []);

  useEffect(() => {
    blobUrlsRef.current = blobUrls;
  }, [blobUrls]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      for (const url of blobUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    // 以前の版が画面側に覚えていた進め方と予算を、先に設定へ移してから読む
    void ensureGenerationPreferencesMigrated()
      .then(() => window.electronAPI.settings.get())
      .then((value) => {
        if (active) setSettings(normalizeSettings(value));
      })
      .catch(() => {
        if (active) setSettings(normalizeSettings({}));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectId) return;
      try {
        const loaded = await projectClient.load(projectId);
        if (cancelled) return;

        setProject(loaded);
        setFormDefaults({
          title: loaded.article?.title ?? '',
          source: loaded.article?.source ?? '',
          bodyText: loaded.article?.bodyText ?? '',
        });
        const normalizedProfile = normalizePresentationProfile(loaded.presentationProfile);
        setPresentationProfile(normalizedProfile);
        savedPresentationProfileRef.current = JSON.stringify(normalizedProfile);
        if (typeof loaded.generationConfig?.targetPartCount === 'number')
          setTargetPartCount(loaded.generationConfig.targetPartCount);
        if (loaded.parts?.length) {
          setTargetPartCount(Math.min(20, Math.max(1, loaded.parts.length)));
        }

        if (loaded.job && isJobResumable(loaded.job))
          setRunOptions({
            mode: loaded.job.mode,
            budgetUsd: loaded.job.budgetUsd === undefined ? '' : String(loaded.job.budgetUsd),
          });

        setImages((loaded.article?.importedImages ?? []) as ImageAsset[]);
        setBlobUrls((prev) => {
          for (const url of prev.values()) {
            URL.revokeObjectURL(url);
          }
          return new Map();
        });
      } catch (err) {
        console.error('Failed to load project:', err);
        reportError(err, 'プロジェクトを読み込めませんでした');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, reportError, setProject]);

  // 詳細設定の変更はプロジェクトに自動で保存する
  useEffect(() => {
    if (!project) return;

    const serialized = JSON.stringify(presentationProfile);
    if (serialized === savedPresentationProfileRef.current) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        const updatedProject: Project = {
          ...project,
          presentationProfile,
          updatedAt: new Date().toISOString(),
        };
        await projectClient.save(updatedProject);
        savedPresentationProfileRef.current = serialized;
        setProject(updatedProject);
      } catch (err) {
        console.error('Failed to save presentation profile:', err);
        reportError(err, '詳細設定を保存できませんでした');
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [presentationProfile, project, reportError, setProject]);

  const applyPresentationPreset = (preset: PresentationProfilePreset) => {
    const presetDefaults = getDefaultPresentationProfile(preset);
    setPresentationProfile((prev) => ({
      ...prev,
      preset,
      tone: presetDefaults.tone,
      targetDurationPerPartSec: presetDefaults.targetDurationPerPartSec,
    }));
  };

  const closingLinePreview = useMemo(
    () => resolvePresentationClosingLine(presentationProfile),
    [presentationProfile]
  );

  const running = isJobActive(job);
  const resumable = isJobResumable(job);
  const hasScript = (project?.parts.length ?? 0) > 0;
  // 進め方と予算の既定値は設定(AppSettings)に保存する。変えると次の「おまかせで作る」から使う
  const preferences = preferencesFromSettings(settings ?? DEFAULT_SETTINGS);
  const runSettings = runOptions ?? preferences;
  const updateRunSettings = (patch: Partial<GenerationPreferences>) => {
    setRunOptions({ ...runSettings, ...patch });
    const update = preferencesToSettings(patch);
    setSettings((previous) => (previous ? { ...previous, ...update } : previous));
    void saveGenerationPreferences(update).catch((err) =>
      reportError(err, '進め方と予算を保存できませんでした')
    );
  };

  // 「続きから」はジョブを開始したときの設定で進むので、必要なキーもその設定で判定する
  const jobSettings = useMemo(() => (job ? normalizeSettings(job.settings) : null), [job]);
  const missingFor = useCallback(
    (selection: AppSettings | null) =>
      selection && keysLoaded
        ? requiredServices(selection).filter((service) => keyStatus[service] === false)
        : [],
    [keyStatus, keysLoaded]
  );
  const freshMissing = missingFor(settings);
  const resumeMissing = resumable ? missingFor(jobSettings) : [];
  const missingKeys = [...new Set([...(resumable ? resumeMissing : []), ...freshMissing])];

  const startJob = async (data: ArticleInputType, restart: boolean) => {
    if (!projectId || !project) return;
    setError(null);
    setStarting(true);
    try {
      const latestKeys = await refreshKeys();
      const selection = !restart && resumable ? jobSettings : settings;
      if (selection && requiredServices(selection).some((service) => !latestKeys[service])) {
        toast.warning('先に API キーを設定してください。', 'API キーが未設定です');
        return;
      }
      await projectClient.save({
        ...project,
        article: { ...project.article, ...data, importedImages: images },
        presentationProfile,
      });
      await window.electronAPI.jobs.start(projectId, {
        mode: runSettings.mode,
        targetPartCount,
        budgetUsd: budgetToUsd(runSettings.budgetUsd),
        restart,
      });
      toast.info(
        '進み具合は画面上部に表示します。ほかの画面に移っても止まりません。',
        restart ? '最初から作り直しています' : '自動生成を始めました'
      );
    } catch (err) {
      reportError(
        err,
        restart ? '作り直しを始められませんでした' : '自動生成を始められませんでした'
      );
    } finally {
      if (isMountedRef.current) setStarting(false);
    }
  };

  const confirmRestart = async (data: ArticleInputType, reason?: string) => {
    const accepted = await confirm({
      title: '最初から作り直しますか？',
      description: `${reason ?? ''}台本から作り直します。今の台本・画像・音声は、新しく作るものに置き換わります。`,
      confirmLabel: '作り直す',
      confirmVariant: 'primary',
    });
    if (accepted) await startJob(data, true);
  };

  // 台本があるのにシーン数を変えたときは、台本から作り直さないと反映されない(台本が新しければ作り直さないため)
  const startFresh = (data: ArticleInputType) => {
    if (project && project.parts.length > 0 && targetPartCount !== project.parts.length) {
      void confirmRestart(
        data,
        `シーン数を ${project.parts.length} から ${targetPartCount} に変えたため、`
      );
      return;
    }
    void startJob(data, false);
  };

  const restartAction: ArticleAction = {
    key: 'restart',
    label: '最初から作り直す',
    variant: 'secondary',
    disabled: starting || freshMissing.length > 0,
    onClick: (data) => void confirmRestart(data),
  };
  const actions: ArticleAction[] = running
    ? [{ key: 'running', label: '生成中…', disabled: true, onClick: () => {} }]
    : resumable
      ? [
          restartAction,
          {
            key: 'resume',
            label: starting ? '開始しています…' : '続きから',
            disabled: starting || resumeMissing.length > 0,
            onClick: (data) => void startJob(data, false),
          },
        ]
      : [
          ...(hasScript ? [restartAction] : []),
          {
            key: 'start',
            label: starting ? '開始しています…' : 'おまかせで作る',
            disabled: starting || freshMissing.length > 0,
            onClick: startFresh,
          },
        ];

  const handleImagesAdded = (added: ImageAsset[], addedBlobUrls: Map<string, string>) => {
    setImages((prev) => [...prev, ...added]);
    setProject((previous) =>
      previous
        ? {
            ...previous,
            article: {
              ...previous.article,
              importedImages: [...previous.article.importedImages, ...added],
            },
          }
        : previous
    );
    setBlobUrls((prev) => {
      const next = new Map(prev);
      for (const [id, url] of addedBlobUrls.entries()) {
        next.set(id, url);
      }
      return next;
    });
  };

  const handleImageRemoved = (imageId: string) => {
    setImages((prev) => prev.filter((image) => image.id !== imageId));
    setProject((previous) =>
      previous
        ? {
            ...previous,
            article: {
              ...previous.article,
              importedImages: previous.article.importedImages.filter(
                (image) => image.id !== imageId
              ),
            },
          }
        : previous
    );
    setBlobUrls((prev) => {
      const next = new Map(prev);
      const url = next.get(imageId);
      if (url) URL.revokeObjectURL(url);
      next.delete(imageId);
      return next;
    });
  };

  const advancedSettings = (
    <Details
      summary={
        <>
          詳細設定
          <span className="font-normal text-[var(--nv-color-muted)]">
            シーン数・長さ・声・画像の雰囲気・進め方など
          </span>
        </>
      }
      bodyClassName="grid gap-4 md:grid-cols-2"
    >
      <div>
        <label htmlFor="article-preset" className={fieldLabel}>
          用途
        </label>
        <select
          id="article-preset"
          value={presentationProfile.preset}
          onChange={(e) => applyPresentationPreset(e.target.value as PresentationProfilePreset)}
          className="nv-input"
        >
          {PRESENTATION_PROFILE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {PRESENTATION_PROFILE_PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
        <p className={fieldHint}>
          {PRESENTATION_PROFILE_PRESET_DESCRIPTIONS[presentationProfile.preset]}
        </p>
      </div>

      <div>
        <label htmlFor="article-scene-count" className={fieldLabel}>
          シーン数(1〜20)
        </label>
        <input
          id="article-scene-count"
          type="number"
          min={1}
          max={20}
          value={targetPartCount}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            setTargetPartCount(Math.min(20, Math.max(1, Math.round(next))));
          }}
          className="nv-input w-28"
        />
        <p className={fieldHint}>
          シーンごとに画像と音声を作ります。あとから台本画面で変えられます。
        </p>
      </div>

      <div>
        <label htmlFor="article-duration" className={fieldLabel}>
          1 シーンの長さの目安(秒)
        </label>
        <input
          id="article-duration"
          type="number"
          min={10}
          max={300}
          value={presentationProfile.targetDurationPerPartSec}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            setPresentationProfile((prev) => ({
              ...prev,
              targetDurationPerPartSec: Math.min(300, Math.max(10, Math.round(next))),
            }));
          }}
          className="nv-input w-28"
        />
        <p className={fieldHint}>10〜300 秒。用途を選ぶと目安の値が入ります。</p>
      </div>

      <div>
        <label htmlFor="article-closing" className={fieldLabel}>
          締めのひとこと
        </label>
        <select
          id="article-closing"
          value={presentationProfile.closingLineMode}
          onChange={(e) =>
            setPresentationProfile((prev) => ({
              ...prev,
              closingLineMode: e.target.value as PresentationProfile['closingLineMode'],
            }))
          }
          className="nv-input"
        >
          {Object.entries(CLOSING_LINE_LABELS).map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
        {presentationProfile.closingLineMode === 'custom' ? (
          <input
            type="text"
            aria-label="締めのひとこと(自分で入力)"
            value={presentationProfile.closingLineText}
            onChange={(e) =>
              setPresentationProfile((prev) => ({ ...prev, closingLineText: e.target.value }))
            }
            className="nv-input mt-2"
            placeholder="ご視聴ありがとうございました"
          />
        ) : (
          <p className={fieldHint}>読み上げる文: {closingLinePreview ?? 'なし'}</p>
        )}
      </div>

      <div>
        <label htmlFor="article-image-style" className={fieldLabel}>
          画像の雰囲気
        </label>
        <select
          id="article-image-style"
          value={presentationProfile.imageStylePreset}
          onChange={(e) =>
            setPresentationProfile((prev) => ({
              ...prev,
              imageStylePreset: e.target.value as PresentationProfile['imageStylePreset'],
            }))
          }
          className="nv-input"
        >
          {IMAGE_STYLE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {IMAGE_STYLE_PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
        <p className={fieldHint}>
          {IMAGE_STYLE_PRESET_DESCRIPTIONS[presentationProfile.imageStylePreset]}
        </p>
      </div>

      <div>
        <label htmlFor="article-aspect" className={fieldLabel}>
          画面の縦横
        </label>
        <select
          id="article-aspect"
          value={presentationProfile.aspectRatio}
          onChange={(e) =>
            setPresentationProfile((prev) => ({
              ...prev,
              aspectRatio: e.target.value as PresentationProfile['aspectRatio'],
            }))
          }
          className="nv-input"
        >
          {IMAGE_ASPECT_RATIOS.map((aspectRatio) => (
            <option key={aspectRatio} value={aspectRatio}>
              {IMAGE_ASPECT_RATIO_LABELS[aspectRatio]}
            </option>
          ))}
        </select>
        <p className={fieldHint}>画像と動画の両方に使います。</p>
      </div>

      <div>
        <label htmlFor="article-voice-style" className={fieldLabel}>
          読み上げの話し方
        </label>
        <select
          id="article-voice-style"
          value={presentationProfile.ttsNarrationStylePreset}
          onChange={(e) =>
            setPresentationProfile((prev) => ({
              ...prev,
              ttsNarrationStylePreset: e.target
                .value as PresentationProfile['ttsNarrationStylePreset'],
            }))
          }
          className="nv-input"
        >
          {TTS_NARRATION_STYLE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {TTS_NARRATION_STYLE_LABELS[preset]}
            </option>
          ))}
        </select>
        <p className={fieldHint}>
          {TTS_NARRATION_STYLE_DESCRIPTIONS[presentationProfile.ttsNarrationStylePreset]}
        </p>
      </div>

      <div>
        <label htmlFor="article-voice-note" className={fieldLabel}>
          読み上げの補足(任意)
        </label>
        <input
          id="article-voice-note"
          type="text"
          value={presentationProfile.ttsNarrationStyleNote}
          onChange={(e) =>
            setPresentationProfile((prev) => ({
              ...prev,
              ttsNarrationStyleNote: e.target.value,
            }))
          }
          className="nv-input"
          placeholder="例: 語尾はやわらかく、あおりすぎない"
        />
      </div>

      <div>
        <label htmlFor="article-mode" className={fieldLabel}>
          自動生成の進め方
        </label>
        <select
          id="article-mode"
          value={runSettings.mode}
          onChange={(e) =>
            updateRunSettings({ mode: e.target.value === 'review' ? 'review' : 'automatic' })
          }
          className="nv-input"
        >
          <option value="automatic">最後まで自動で進める(おすすめ)</option>
          <option value="review">台本と素材ができたところで止めて確認する</option>
        </select>
        <p className={fieldHint}>確認しながら進めると、途中で 2 回止まります。</p>
      </div>

      <div>
        <label htmlFor="article-budget" className={fieldLabel}>
          1 回の予算の上限(USD)
        </label>
        <input
          id="article-budget"
          type="number"
          min="0"
          step="0.1"
          value={runSettings.budgetUsd}
          onChange={(e) => updateRunSettings({ budgetUsd: e.target.value })}
          className="nv-input w-32"
          placeholder="上限なし"
        />
        <p className={fieldHint}>
          空欄なら上限なし。上限に近づくと止まり、画面上部から続けられます。
        </p>
      </div>
    </Details>
  );

  const photos = (
    <Details
      summary={
        <>
          写真を追加(任意)
          {images.length > 0 && (
            <span className="font-normal text-[var(--nv-color-muted)]">{images.length} 枚</span>
          )}
        </>
      }
    >
      <p className="mb-3 text-xs text-[var(--nv-color-muted)]">
        記事に関係する写真を登録すると、画像画面でシーンの画像として使えます。
      </p>
      <ImageDropzone
        images={images}
        projectId={projectId}
        onImagesAdded={handleImagesAdded}
        onImageRemoved={handleImageRemoved}
        blobUrlMap={blobUrls}
      />
    </Details>
  );

  const keyWarning = missingKeys.length > 0 && (
    <div
      role="alert"
      className="nv-surface flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-[var(--nv-color-warning)] px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--nv-color-text)]">
          {missingKeys.map((service) => API_KEY_SERVICE_INFO[service].name).join('・')} の API
          キーが未設定です
        </p>
        <p className="text-xs text-[var(--nv-color-muted)]">設定すると生成を始められます。</p>
      </div>
      <Button size="sm" onClick={() => openSettings('api')}>
        API キーを設定する
      </Button>
    </div>
  );

  const stoppedText =
    job?.status === 'paused' && job.stage === BUDGET_STAGE
      ? '予算の上限に近づいたため止まっています。「詳細設定」で予算を増やすか空欄にしてから「続きから」を押してください。'
      : job?.status === 'paused'
        ? '確認待ちです。台本や素材を確認したら「続きから」を押してください。'
        : '途中で止まった自動生成があります。「続きから」を押すと、止まったところから再開します。';
  const statusNote = running ? (
    <p className="text-sm text-[var(--nv-color-muted)]">
      生成しています。進み具合は画面上部に出ています。止めるときは上部の「停止」を押してください。
    </p>
  ) : resumable ? (
    <p className="text-sm text-[var(--nv-color-muted)]">{stoppedText}</p>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="記事" subtitle={project?.name} />

      {projectId && <WorkflowNav projectId={projectId} current="article" project={project} />}

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {error && (
            <FriendlyError
              title={error.title}
              error={error.error}
              onDismiss={() => setError(null)}
            />
          )}

          <section className="nv-surface p-5">
            <p className="mb-4 text-sm text-[var(--nv-color-muted)]">
              記事を貼り付けて「おまかせで作る」を押すと、台本・画像・音声を作り、動画に仕上げます。入力は自動で保存されます。
            </p>
            <ArticleInput
              defaultValues={formDefaults}
              bodyLength={project?.article.bodyText.length ?? 0}
              onChange={(data) => {
                setProject((previous) =>
                  previous
                    ? {
                        ...previous,
                        name:
                          previous.name === '新しい動画' && data.title?.trim()
                            ? data.title.trim()
                            : previous.name,
                        article: { ...previous.article, ...data, importedImages: images },
                      }
                    : previous
                );
              }}
              footer={
                <div className="space-y-3">
                  {advancedSettings}
                  {photos}
                  {keyWarning}
                  {project && settings && (
                    <GenerationQuote
                      project={project}
                      partCount={targetPartCount}
                      settings={settings}
                    />
                  )}
                  {statusNote}
                </div>
              }
              actions={actions}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
