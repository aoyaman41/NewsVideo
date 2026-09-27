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
import { Badge, Button, Details, useConfirm, useToast } from '../components/ui';
import {
  budgetToUsd,
  ensureGenerationPreferencesMigrated,
  preferencesFromSettings,
  type GenerationPreferences,
} from '../stores/generationPreferences';
import { useJobFeed } from '../stores/jobStore';
import { formatCost } from '../utils/money';
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
  getDefaultPresentationProfile,
  normalizePresentationProfile,
  resolvePresentationClosingLine,
  type PresentationProfilePreset,
} from '../../shared/project/presentationProfile';
import {
  DEFAULT_SCENE_COUNT,
  PURPOSES,
  PURPOSE_SPECS,
  applyNewProjectDefaults,
  describePurpose,
  purposeProfile,
} from '../../shared/project/purposes';
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

/**
 * 記事画面の詳細設定のうち、「既定」と比べて印を付け、「既定に戻す」で戻す項目。
 * 既定は、この動画の用途に設定の「新しい動画」の既定値を重ねたもの(進め方と予算は設定の値)
 */
type ArticleOverrideKey =
  | 'targetPartCount'
  | 'targetDurationPerPartSec'
  | 'closingLine'
  | 'imageStylePreset'
  | 'aspectRatio'
  | 'ttsNarrationStylePreset'
  | 'ttsNarrationStyleNote'
  | 'mode'
  | 'budget';

/** 自動保存の比較に使う、詳細設定(見せ方とシーン数)の値 */
function detailsKey(profile: PresentationProfile, targetPartCount: number): string {
  return JSON.stringify({ profile, targetPartCount });
}

/** 記事画面には出していない、「新しい動画」の既定値の項目(画像画面・動画画面で変える) */
const OTHER_DEFAULT_ITEMS: Array<{ label: string; keys: (keyof PresentationProfile)[] }> = [
  { label: '画像の補足', keys: ['styleReferenceNote'] },
  {
    label: '締めの画面',
    keys: ['closingCardEnabled', 'closingCardHeadline', 'closingCardCtaText'],
  },
  { label: '出典の表示', keys: ['sourceDisplayMode', 'sourceDisplayText'] },
];

const NO_CHANGES: Record<ArticleOverrideKey, boolean> = {
  targetPartCount: false,
  targetDurationPerPartSec: false,
  closingLine: false,
  imageStylePreset: false,
  aspectRatio: false,
  ttsNarrationStylePreset: false,
  ttsNarrationStyleNote: false,
  mode: false,
  budget: false,
};

/** 既定と違う項目に付ける印 */
function ChangedMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="info" className="ml-2 align-middle">
      既定から変更
    </Badge>
  );
}

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
  const [targetPartCount, setTargetPartCount] = useState<number>(DEFAULT_SCENE_COUNT);
  const [presentationProfile, setPresentationProfile] = useState<PresentationProfile>(
    getDefaultPresentationProfile()
  );
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // 進め方と予算は、この回の生成だけに使う(設定の既定値は変えない)。
  // 止まっているジョブがあるときは、そのジョブの進め方と予算を初期値にする(「続きから」で使う値を画面に出す)
  const [runOptions, setRunOptions] = useState<GenerationPreferences | null>(null);
  const { status: keyStatus, loaded: keysLoaded, refresh: refreshKeys } = useApiKeyStatus();
  const trackedJob = useJobFeed().jobs.get(projectId ?? '')?.job;
  const job = trackedJob ?? project?.job;

  const isMountedRef = useRef(true);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  // 保存済みの詳細設定(見せ方とシーン数)。変わったときだけ保存する
  const savedDetailsRef = useRef<string>(
    detailsKey(getDefaultPresentationProfile(), DEFAULT_SCENE_COUNT)
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
        // シーン数は、保存した値(なければ用途のシーン数)。台本があればそのシーン数
        const savedCount =
          typeof loaded.generationConfig?.targetPartCount === 'number'
            ? loaded.generationConfig.targetPartCount
            : PURPOSE_SPECS[normalizedProfile.preset].parts;
        const initialCount = loaded.parts?.length
          ? Math.min(20, Math.max(1, loaded.parts.length))
          : savedCount;
        setPresentationProfile(normalizedProfile);
        setTargetPartCount(initialCount);
        // 読み込んだだけでは保存しない(台本のシーン数を表示しているときも)
        savedDetailsRef.current = detailsKey(normalizedProfile, initialCount);

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

  // 詳細設定の変更(見せ方とシーン数)はプロジェクトに自動で保存する。
  // シーン数は generationConfig.targetPartCount に保存し、開き直したときに用途の値と食い違わないようにする
  useEffect(() => {
    if (!project) return;

    const serialized = detailsKey(presentationProfile, targetPartCount);
    if (serialized === savedDetailsRef.current) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        const updatedProject: Project = {
          ...project,
          presentationProfile,
          generationConfig: { ...project.generationConfig, targetPartCount },
          updatedAt: new Date().toISOString(),
        };
        await projectClient.save(updatedProject);
        savedDetailsRef.current = serialized;
        setProject(updatedProject);
      } catch (err) {
        console.error('Failed to save presentation profile:', err);
        reportError(err, '詳細設定を保存できませんでした');
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [presentationProfile, project, reportError, setProject, targetPartCount]);

  // 用途を変えたら、用途の性格を決める項目(話し方の調子・1 シーンの長さ・画面の縦横・シーン数)を用途の値にする。
  // 見た目と締めの項目はそのまま(既定と違えば印が付き、「既定に戻す」で新しい用途の既定にできる)
  const applyPresentationPreset = (preset: PresentationProfilePreset) => {
    const profile = purposeProfile(preset);
    setPresentationProfile((prev) => ({
      ...prev,
      preset,
      tone: profile.tone,
      targetDurationPerPartSec: profile.targetDurationPerPartSec,
      aspectRatio: profile.aspectRatio,
    }));
    setTargetPartCount(PURPOSE_SPECS[preset].parts);
  };

  const closingLinePreview = useMemo(
    () => resolvePresentationClosingLine(presentationProfile),
    [presentationProfile]
  );

  const running = isJobActive(job);
  const resumable = isJobResumable(job);
  const hasScript = (project?.parts.length ?? 0) > 0;
  // 進め方と予算の既定値は設定の「新しい動画」で決める。ここでの変更は、この回の生成だけに使う(既定値は変えない)
  const preferences = preferencesFromSettings(settings ?? DEFAULT_SETTINGS);
  const runSettings = runOptions ?? preferences;
  const updateRunSettings = (patch: Partial<GenerationPreferences>) => {
    setRunOptions({ ...runSettings, ...patch });
  };

  // この動画の「既定」: 用途に「新しい動画」の既定値を重ねたもの。違う項目に印を付ける
  const videoDefaults = useMemo(
    () =>
      applyNewProjectDefaults(
        presentationProfile.preset,
        (settings ?? DEFAULT_SETTINGS).newProjectDefaults
      ),
    [presentationProfile.preset, settings]
  );
  const defaultProfile = videoDefaults.presentationProfile;
  // 設定と動画を読み込むまでは比べない(読み込み前の仮の値で印が出ないように)
  const changed: Record<ArticleOverrideKey, boolean> = !(settings && project)
    ? NO_CHANGES
    : {
        targetPartCount: targetPartCount !== videoDefaults.targetPartCount,
        targetDurationPerPartSec:
          presentationProfile.targetDurationPerPartSec !== defaultProfile.targetDurationPerPartSec,
        closingLine:
          presentationProfile.closingLineMode !== defaultProfile.closingLineMode ||
          (presentationProfile.closingLineMode === 'custom' &&
            presentationProfile.closingLineText.trim() !== defaultProfile.closingLineText.trim()),
        imageStylePreset: presentationProfile.imageStylePreset !== defaultProfile.imageStylePreset,
        aspectRatio: presentationProfile.aspectRatio !== defaultProfile.aspectRatio,
        ttsNarrationStylePreset:
          presentationProfile.ttsNarrationStylePreset !== defaultProfile.ttsNarrationStylePreset,
        ttsNarrationStyleNote:
          presentationProfile.ttsNarrationStyleNote.trim() !==
          defaultProfile.ttsNarrationStyleNote.trim(),
        mode: runSettings.mode !== preferences.mode,
        budget: budgetToUsd(runSettings.budgetUsd) !== budgetToUsd(preferences.budgetUsd),
      };
  const changedCount = Object.values(changed).filter(Boolean).length;
  // 記事画面に出していない項目が既定と違うときは、どこで変えられるかを添える(「既定に戻す」では戻さない)
  const otherChanged =
    settings && project
      ? OTHER_DEFAULT_ITEMS.filter((item) =>
          item.keys.some(
            (key) =>
              JSON.stringify(presentationProfile[key]) !== JSON.stringify(defaultProfile[key])
          )
        ).map((item) => item.label)
      : [];
  const resetToDefaults = () => {
    setPresentationProfile((prev) => ({
      ...prev,
      targetDurationPerPartSec: defaultProfile.targetDurationPerPartSec,
      closingLineMode: defaultProfile.closingLineMode,
      closingLineText: defaultProfile.closingLineText,
      imageStylePreset: defaultProfile.imageStylePreset,
      aspectRatio: defaultProfile.aspectRatio,
      ttsNarrationStylePreset: defaultProfile.ttsNarrationStylePreset,
      ttsNarrationStyleNote: defaultProfile.ttsNarrationStyleNote,
    }));
    setTargetPartCount(videoDefaults.targetPartCount);
    setRunOptions(null);
  };
  // 以前の記事画面で選べた用途(報告)の動画は、その用途も選択肢に残す
  const purposeOptions = PURPOSES.some((item) => item.id === presentationProfile.preset)
    ? PURPOSES
    : [...PURPOSES, PURPOSE_SPECS[presentationProfile.preset]];

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
            {changedCount > 0
              ? `この動画だけ ${changedCount} 項目を既定から変えています`
              : 'シーン数・長さ・声・画像の雰囲気・進め方など'}
          </span>
        </>
      }
      bodyClassName="grid gap-4 md:grid-cols-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-2">
        <div className="min-w-0 space-y-1">
          <p className="nv-help">
            ここでの変更は、この動画だけに使います。既定は設定の「新しい動画」で変えられます。「既定に戻す」は、ここに出ている項目を戻します。
          </p>
          {otherChanged.length > 0 && (
            <p className="nv-help">
              このほか {otherChanged.join('・')}
              も既定と違います(画像画面・動画画面で変えられます)。
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => openSettings('newVideo')}>
            既定を見る
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={changedCount === 0}
            onClick={resetToDefaults}
          >
            既定に戻す
          </Button>
        </div>
      </div>

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
          {purposeOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <p className={fieldHint}>
          {describePurpose(PURPOSE_SPECS[presentationProfile.preset])}
          。用途を変えると、画面の縦横・長さ・シーン数も変わります。
        </p>
      </div>

      <div>
        <label htmlFor="article-scene-count" className={fieldLabel}>
          シーン数(1〜20)
          <ChangedMark show={changed.targetPartCount} />
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
          <ChangedMark show={changed.targetDurationPerPartSec} />
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
          <ChangedMark show={changed.closingLine} />
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
          <ChangedMark show={changed.imageStylePreset} />
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
          <ChangedMark show={changed.aspectRatio} />
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
          <ChangedMark show={changed.ttsNarrationStylePreset} />
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
          <ChangedMark show={changed.ttsNarrationStyleNote} />
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
          <ChangedMark show={changed.mode} />
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
        <p className={fieldHint}>
          確認しながら進めると、途中で 2 回止まります。この回の生成だけに使います。
        </p>
      </div>

      <div>
        <label htmlFor="article-budget" className={fieldLabel}>
          1 回の予算の上限(USD)
          <ChangedMark show={changed.budget} />
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
          {budgetToUsd(runSettings.budgetUsd) !== undefined
            ? `${formatCost(budgetToUsd(runSettings.budgetUsd)!, (settings ?? DEFAULT_SETTINGS).jpyPerUsd)}まで。`
            : ''}
          空欄なら上限なし。上限に近づくと止まり、画面上部から続けられます。この回の生成だけに使います。
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
