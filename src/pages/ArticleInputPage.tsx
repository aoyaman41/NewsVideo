import { JobHistory } from '../components/article/JobHistory';
import { SourceRecords } from '../components/article/SourceRecords';
import { JOB_STATUS_LABELS } from '../../shared/project/jobs';
import { GenerationQuote } from '../components/article/GenerationQuote';
import { projectClient, useProjectState } from '../stores/projectStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ArticleInput, FileImport, ImageDropzone } from '../components/article';
import { Badge, Card, ErrorDetailPanel, StatusChip, useToast } from '../components/ui';
import type {
  ArticleInput as ArticleInputType,
  ImageAsset,
  PresentationProfile,
  Project,
} from '../schemas';
import { createOpenAIUsageRecord } from '../utils/usage';
import {
  CLOSING_LINE_MODE_LABELS,
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

export function ArticleInputPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [project, setProject] = useProjectState(projectId);
  const [articleData, setArticleData] = useState<Partial<ArticleInputType>>({
    title: '',
    source: '',
    bodyText: '',
  });
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<'automatic' | 'review'>('review');
  const [budgetUsd, setBudgetUsd] = useState('5');
  const [error, setError] = useState<string | null>(null);
  const [targetPartCount, setTargetPartCount] = useState<number>(5);
  const [presentationProfile, setPresentationProfile] = useState<PresentationProfile>(
    getDefaultPresentationProfile()
  );
  const isMountedRef = useRef(true);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  const savedPresentationProfileRef = useRef<string>(
    JSON.stringify(getDefaultPresentationProfile())
  );

  const reportError = useCallback(
    (message: string, title?: string) => {
      if (!isMountedRef.current) return;
      setError(message);
      toast.error(message, title);
    },
    [toast]
  );

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
    let cancelled = false;
    const load = async () => {
      if (!projectId) return;
      try {
        const project = await projectClient.load(projectId);
        if (cancelled) return;

        setProject(project);
        setArticleData({
          title: project.article?.title ?? '',
          source: project.article?.source ?? '',
          bodyText: project.article?.bodyText ?? '',
        });
        const normalizedProfile = normalizePresentationProfile(project.presentationProfile);
        setPresentationProfile(normalizedProfile);
        savedPresentationProfileRef.current = JSON.stringify(normalizedProfile);
        if (typeof project.generationConfig?.targetPartCount === 'number')
          setTargetPartCount(project.generationConfig.targetPartCount);
        if (project.parts?.length) {
          const nextCount = Math.min(20, Math.max(1, project.parts.length));
          setTargetPartCount(nextCount);
        }

        const imported = (project.article?.importedImages ?? []) as ImageAsset[];
        setImages(imported);
        setBlobUrls((prev) => {
          for (const url of prev.values()) {
            URL.revokeObjectURL(url);
          }
          return new Map();
        });
      } catch (err) {
        console.error('Failed to load project:', err);
        reportError(
          err instanceof Error ? err.message : 'プロジェクトの読み込みに失敗しました',
          '読み込みに失敗しました'
        );
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, reportError, setProject]);

  useEffect(() => {
    if (!project) return;

    const serialized = JSON.stringify(presentationProfile);
    if (serialized === savedPresentationProfileRef.current) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        const updatedAt = new Date().toISOString();
        const updatedProject: Project = {
          ...project,
          presentationProfile,
          updatedAt,
        };
        await projectClient.save(updatedProject);
        savedPresentationProfileRef.current = serialized;
        setProject(updatedProject);
      } catch (err) {
        console.error('Failed to save presentation profile:', err);
        reportError(
          err instanceof Error ? err.message : '表現設定の保存に失敗しました',
          '表現設定の保存に失敗しました'
        );
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
  const presetDescription = PRESENTATION_PROFILE_PRESET_DESCRIPTIONS[presentationProfile.preset];
  const imageStyleDescription =
    IMAGE_STYLE_PRESET_DESCRIPTIONS[presentationProfile.imageStylePreset];
  const ttsStyleDescription =
    TTS_NARRATION_STYLE_DESCRIPTIONS[presentationProfile.ttsNarrationStylePreset];

  const handleSubmit = async (data: ArticleInputType) => {
    if (!projectId) return;

    setIsGenerating(true);
    setError(null);

    try {
      // 記事データをプロジェクトに保存
      const project = await projectClient.load(projectId);
      project.article = {
        title: data.title,
        source: data.source,
        bodyText: data.bodyText,
        importedImages: images,
      };
      project.presentationProfile = presentationProfile;
      project.updatedAt = new Date().toISOString();
      await projectClient.save(project);

      // スクリプト生成を実行
      const result = await window.electronAPI.ai.generateScript(project.article, {
        tone: presentationProfile.tone,
        targetPartCount,
        targetDurationPerPartSec: presentationProfile.targetDurationPerPartSec,
        closingLine: closingLinePreview,
      });
      const usageRecord = createOpenAIUsageRecord('script_generate', result.usage);

      // 生成されたパートをプロジェクトに保存
      project.parts = result.parts;
      if (usageRecord) {
        project.usage = [...(project.usage ?? []), usageRecord];
      }
      project.updatedAt = new Date().toISOString();
      await projectClient.save(project);

      // スクリプト編集画面に遷移
      navigate(`/projects/${projectId}/script`);
    } catch (err) {
      console.error('Script generation failed:', err);
      reportError(err instanceof Error ? err.message : 'スクリプト生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAutoSubmit = async (data: ArticleInputType, restart = false) => {
    if (!projectId || !project) return;
    try {
      const draft = {
        ...project,
        article: { ...project.article, ...data, importedImages: images },
        presentationProfile,
      };
      await projectClient.save(draft);
      await window.electronAPI.jobs.start(projectId, {
        mode: generationMode,
        targetPartCount,
        budgetUsd: budgetUsd.trim() ? Number(budgetUsd) : undefined,
        restart,
      });
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
    }
  };
  const handleAutoResume = (data: ArticleInputType) => handleAutoSubmit(data);
  const handleAutoRestart = (data: ArticleInputType) => handleAutoSubmit(data, true);
  const handleAutoCancel = () => {
    if (projectId)
      void window.electronAPI.jobs.cancel(projectId).catch((error) => reportError(String(error)));
  };
  const autoRunning = project?.job?.status === 'running' || project?.job?.status === 'queued';
  const currentAutoStatus = project?.job?.stage;

  const handleImportedText = (title: string, text: string) => {
    setProject((previous) =>
      previous
        ? {
            ...previous,
            article: {
              ...previous.article,
              title: previous.article.title.trim() ? previous.article.title : title,
              bodyText: text,
            },
          }
        : previous
    );
    setArticleData((prev) => ({
      ...prev,
      title: prev.title && prev.title.trim().length > 0 ? prev.title : title,
      bodyText: text,
    }));
  };

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="記事" subtitle={project?.name} />

      {projectId && <WorkflowNav projectId={projectId} current="article" project={project} />}

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            {error && <ErrorDetailPanel message={error} onDismiss={() => setError(null)} />}

            <details className="rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                今回の動画の声・見た目・詳細設定
              </summary>
              <Card
                title="今回の生成設定"
                subtitle="このプロジェクトに適用します。アプリ全体の既定値は設定画面で変更できます。"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      配信スタイル
                    </label>
                    <select
                      value={presentationProfile.preset}
                      onChange={(e) =>
                        applyPresentationPreset(e.target.value as PresentationProfilePreset)
                      }
                      className="nv-input"
                    >
                      {PRESENTATION_PROFILE_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {PRESENTATION_PROFILE_PRESET_LABELS[preset]}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-slate-600">{presetDescription}</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      パート数
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
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
                      <Badge tone="info">1〜20</Badge>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      画像を分けたい場合はパート数を増やしてください（後から編集可能）。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      1パートの目安秒数
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
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
                      <Badge tone="neutral">10〜300秒</Badge>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      プリセット初期値は自動で入ります。必要なら上書きできます。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      締め文
                    </label>
                    <select
                      value={presentationProfile.closingLineMode}
                      onChange={(e) =>
                        setPresentationProfile((prev) => ({
                          ...prev,
                          closingLineMode: e.target.value as PresentationProfile['closingLineMode'],
                        }))
                      }
                      className="nv-input"
                    >
                      {Object.entries(CLOSING_LINE_MODE_LABELS).map(([mode, label]) => (
                        <option key={mode} value={mode}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-slate-600">
                      現在の出力予定: {closingLinePreview ?? '締め文なし'}
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      画像スタイル
                    </label>
                    <select
                      value={presentationProfile.imageStylePreset}
                      onChange={(e) =>
                        setPresentationProfile((prev) => ({
                          ...prev,
                          imageStylePreset: e.target
                            .value as PresentationProfile['imageStylePreset'],
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
                    <p className="mt-2 text-xs text-slate-600">{imageStyleDescription}</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      画像アスペクト比
                    </label>
                    <select
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
                    <p className="mt-2 text-xs text-slate-600">
                      画像プロンプト生成と画像生成の両方で使われます。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      音声の話し方
                    </label>
                    <select
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
                    <p className="mt-2 text-xs text-slate-600">{ttsStyleDescription}</p>
                  </div>
                </div>

                {presentationProfile.closingLineMode === 'custom' && (
                  <div className="mt-4">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      カスタム締め文
                    </label>
                    <input
                      type="text"
                      value={presentationProfile.closingLineText}
                      onChange={(e) =>
                        setPresentationProfile((prev) => ({
                          ...prev,
                          closingLineText: e.target.value,
                        }))
                      }
                      className="nv-input"
                      placeholder="ご視聴ありがとうございました"
                    />
                  </div>
                )}

                <div className="mt-4">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    音声スタイル補足
                  </label>
                  <input
                    type="text"
                    value={presentationProfile.ttsNarrationStyleNote}
                    onChange={(e) =>
                      setPresentationProfile((prev) => ({
                        ...prev,
                        ttsNarrationStyleNote: e.target.value,
                      }))
                    }
                    className="nv-input"
                    placeholder="語尾はやわらかく、煽りすぎない"
                  />
                  <p className="mt-2 text-xs text-slate-600">
                    短い補足だけを上書きできます。engine やボイス設定は変更しません。
                  </p>
                </div>
              </Card>
            </details>

            <Card title="記事情報" subtitle="必須項目を入力してスクリプトを生成">
              {project && <GenerationQuote project={project} partCount={targetPartCount} />}
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  生成の進め方
                  <select
                    className="nv-input"
                    value={generationMode}
                    onChange={(event) =>
                      setGenerationMode(event.target.value as 'automatic' | 'review')
                    }
                  >
                    <option value="review">台本・素材を確認しながら</option>
                    <option value="automatic">すべて自動で進める</option>
                  </select>
                </label>
                <label className="text-sm">
                  ジョブ予算（USD、空欄で制限なし）
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="nv-input"
                    value={budgetUsd}
                    onChange={(event) => setBudgetUsd(event.target.value)}
                  />
                </label>
              </div>
              {project?.job && (
                <div className="mb-4 rounded border p-3 text-sm" role="status">
                  <p className="text-xs break-all">ジョブID: {project.job.id}</p>
                  <p>
                    {project.job.stage} / {JOB_STATUS_LABELS[project.job.status]} ・使用額 $
                    {project.job.spentUsd.toFixed(4)}
                  </p>
                  {project.job.unknownCharges > 0 && (
                    <p>
                      料金未確定のリクエスト {project.job.unknownCharges}
                      件。API側の利用明細で確認してください。
                    </p>
                  )}
                  {project.job.error && <p className="text-red-700">{project.job.error.message}</p>}
                  <p>
                    開始前に推定料金の余裕を含めて予算を確認します。実際の料金を厳密に上限へ抑えるものではありません。
                  </p>
                </div>
              )}
              {project && <JobHistory project={project} />}
              <ArticleInput
                onChange={(data) => {
                  setArticleData(data);
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
                onSaveDraft={() => {
                  if (projectId)
                    void projectClient.flush(projectId).catch((error) => setError(String(error)));
                }}
                defaultValues={articleData}
                onSubmit={handleSubmit}
                onAutoSubmit={handleAutoResume}
                onAutoRestart={handleAutoRestart}
                onAutoCancel={handleAutoCancel}
                isLoading={isGenerating}
                isAutoLoading={autoRunning}
              />
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="自動生成" subtitle="記事から動画までをまとめて進行">
              <div className="space-y-3 text-sm text-slate-600">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip
                    tone={autoRunning ? 'info' : 'neutral'}
                    label={autoRunning ? '実行中' : '待機中'}
                  />
                  <Badge tone="info">記事保存 → スクリプト → 画像 → 音声 → 動画</Badge>
                </div>
                <p className="text-xs text-slate-600">
                  台本と素材の確認時には、記事フォームの「続きから自動生成」で再開できます。
                </p>
                <div className="rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 px-3 py-3 text-xs">
                  {autoRunning && currentAutoStatus ? (
                    <span className="text-blue-700">自動生成中: {currentAutoStatus}</span>
                  ) : (
                    <span className="text-slate-600">
                      必要なときに「記事から動画まで自動生成」を実行できます。
                    </span>
                  )}
                </div>
              </div>
            </Card>

            {project && <SourceRecords project={project} onChange={setProject} />}
            <Card title="テキストインポート" subtitle="txt / md / docx を読み込み">
              <FileImport onTextImported={handleImportedText} />
            </Card>

            <Card title="記事関連画像" subtitle="ドラッグ&ドロップで登録">
              <ImageDropzone
                images={images}
                projectId={projectId}
                onImagesAdded={handleImagesAdded}
                onImageRemoved={handleImageRemoved}
                blobUrlMap={blobUrls}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
