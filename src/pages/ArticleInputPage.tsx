import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ArticleInput, FileImport, ImageDropzone } from '../components/article';
import { Badge, Card, StatusChip } from '../components/ui';
import type {
  ArticleInput as ArticleInputType,
  AutoGenerationStatus,
  ImageAsset,
  Project,
} from '../schemas';
import { nextActionLabel, stageLabel, summarizeProjectProgress } from '../utils/projectHealth';
import {
  createGeminiImageUsageRecord,
  createGeminiTtsUsageRecord,
  createOpenAIUsageRecord,
} from '../utils/usage';

export function ArticleInputPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [articleData, setArticleData] = useState<Partial<ArticleInputType>>({
    title: '',
    source: '',
    bodyText: '',
  });
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetPartCount, setTargetPartCount] = useState<number>(5);
  const autoCancelRef = useRef(false);
  const isMountedRef = useRef(true);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    blobUrlsRef.current = blobUrls;
  }, [blobUrls]);

  useEffect(() => {
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
        const project = await window.electronAPI.project.load(projectId);
        if (cancelled) return;

        setProject(project);
        setArticleData({
          title: project.article?.title ?? '',
          source: project.article?.source ?? '',
          bodyText: project.article?.bodyText ?? '',
        });
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

        if (project.autoGenerationStatus?.running) {
          setIsAutoGenerating(true);
          setAutoStatus(project.autoGenerationStatus.step ?? '自動生成中...');
        } else {
          setIsAutoGenerating(false);
          setAutoStatus(null);
        }
      } catch (err) {
        console.error('Failed to load project:', err);
        setError(err instanceof Error ? err.message : 'プロジェクトの読み込みに失敗しました');
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const latest = await window.electronAPI.project.load(projectId);
        if (cancelled) return;
        setProject(latest);

        if (latest.autoGenerationStatus?.running) {
          setIsAutoGenerating(true);
          setAutoStatus(latest.autoGenerationStatus.step ?? '自動生成中...');
        } else {
          setIsAutoGenerating(false);
          setAutoStatus(null);
        }
      } catch {
        // noop
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  const notifyCompletion = (message: string) => {
    if (!('Notification' in window)) {
      alert(message);
      return;
    }

    if (Notification.permission === 'granted') {
      new Notification('自動生成完了', { body: message });
      return;
    }

    if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          new Notification('自動生成完了', { body: message });
        } else {
          alert(message);
        }
      });
      return;
    }

    alert(message);
  };

  const setProjectSafe = (next: Project | null) => {
    if (!isMountedRef.current) return;
    setProject(next);
  };

  const setErrorSafe = (next: string | null) => {
    if (!isMountedRef.current) return;
    setError(next);
  };

  const setAutoStatusSafe = (next: string | null) => {
    if (!isMountedRef.current) return;
    setAutoStatus(next);
  };

  const setIsAutoGeneratingSafe = (next: boolean) => {
    if (!isMountedRef.current) return;
    setIsAutoGenerating(next);
  };

  const updateAutoStatus = async (
    project: Project,
    patch: (Partial<AutoGenerationStatus> & { running: boolean }) & {
      clearLastVideoPath?: boolean;
      lastVideoPath?: string;
    }
  ) => {
    const now = new Date().toISOString();
    let latestStatus = project.autoGenerationStatus;
    if (projectId) {
      try {
        const latest = await window.electronAPI.project.load(projectId);
        latestStatus = latest.autoGenerationStatus ?? latestStatus;
      } catch {
        // ignore
      }
    }
    const startedAt = patch.startedAt ?? latestStatus?.startedAt ?? now;
    const cancelRequested = patch.cancelRequested ?? latestStatus?.cancelRequested ?? false;
    const isNewRun = patch.running && Boolean(patch.startedAt);
    const finishedAt =
      patch.running === false
        ? (patch.finishedAt ?? now)
        : isNewRun
          ? undefined
          : (patch.finishedAt ?? latestStatus?.finishedAt);
    const mergedSteps = {
      ...(latestStatus?.steps ?? {}),
      ...(patch.steps ?? {}),
    };
    const shouldClear = patch.clearLastVideoPath === true;
    const hasLastVideoPath = Object.prototype.hasOwnProperty.call(patch, 'lastVideoPath');
    const lastVideoPathRaw = shouldClear
      ? undefined
      : hasLastVideoPath
        ? patch.lastVideoPath
        : latestStatus?.lastVideoPath;
    const lastVideoPath = lastVideoPathRaw || undefined;

    project.autoGenerationStatus = {
      running: patch.running,
      step: patch.step ?? latestStatus?.step,
      startedAt,
      updatedAt: now,
      finishedAt,
      cancelRequested,
      error: patch.error,
      steps: Object.keys(mergedSteps).length > 0 ? mergedSteps : undefined,
      lastVideoPath,
    };
    project.updatedAt = now;
    await window.electronAPI.project.save(project);
    setProjectSafe(project);
    if (patch.step) {
      setAutoStatusSafe(patch.step);
    }
  };

  const ensureNotCancelled = async () => {
    if (autoCancelRef.current) {
      throw new Error('キャンセルしました');
    }
    if (!projectId) return;
    try {
      const latest = await window.electronAPI.project.load(projectId);
      if (latest.autoGenerationStatus?.cancelRequested) {
        throw new Error('キャンセルしました');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('キャンセル')) {
        throw err;
      }
    }
  };

  const buildTtsOptions = (settings: {
    ttsEngine?: string;
    ttsVoice?: string;
    ttsSpeakingRate?: number;
    ttsPitch?: number;
  }) => {
    const voiceName = settings.ttsVoice || 'Charon';
    const match = voiceName.match(/^([a-z]{2}-[A-Z]{2})/);
    const languageCode = match?.[1] || 'ja-JP';

    return {
      ttsEngine: (settings.ttsEngine as 'google_tts' | 'gemini_tts' | 'macos_tts') || 'gemini_tts',
      voiceName,
      languageCode,
      speakingRate: Number.isFinite(settings.ttsSpeakingRate) ? settings.ttsSpeakingRate! : 1.0,
      pitch: Number.isFinite(settings.ttsPitch) ? settings.ttsPitch! : 0,
      audioEncoding: 'MP3' as const,
    };
  };

  const resolveVideoOptions = (
    settings: {
      videoResolution?: '1920x1080' | '1280x720' | '3840x2160';
      videoFps?: number;
      videoBitrate?: string;
      audioBitrate?: string;
      openingVideoPath?: string;
      endingVideoPath?: string;
    },
    project: Project
  ) => {
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'output';
    const outputPath = `${project.path}/output/${safeName}.mp4`;

    return {
      outputPath,
      renderOptions: {
        resolution: settings.videoResolution ?? '1920x1080',
        fps: settings.videoFps ?? 30,
        videoBitrate: settings.videoBitrate ?? '8M',
        audioBitrate: settings.audioBitrate ?? '192k',
        includeOpening: Boolean(settings.openingVideoPath),
        includeEnding: Boolean(settings.endingVideoPath),
      },
    };
  };

  const handleSubmit = async (data: ArticleInputType) => {
    if (!projectId) return;

    setIsGenerating(true);
    setError(null);

    try {
      // 記事データをプロジェクトに保存
      const project = await window.electronAPI.project.load(projectId);
      project.article = {
        title: data.title,
        source: data.source,
        bodyText: data.bodyText,
        importedImages: images,
      };
      project.updatedAt = new Date().toISOString();
      await window.electronAPI.project.save(project);

      // スクリプト生成を実行
      const result = await window.electronAPI.ai.generateScript(project.article, {
        tone: 'news',
        targetPartCount,
      });
      const usageRecord = createOpenAIUsageRecord('script_generate', result.usage);

      // 生成されたパートをプロジェクトに保存
      project.parts = result.parts;
      if (usageRecord) {
        project.usage = [...(project.usage ?? []), usageRecord];
      }
      project.updatedAt = new Date().toISOString();
      await window.electronAPI.project.save(project);

      // スクリプト編集画面に遷移
      navigate(`/projects/${projectId}/script`);
    } catch (err) {
      console.error('Script generation failed:', err);
      setError(err instanceof Error ? err.message : 'スクリプト生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAutoSubmit = async (data: ArticleInputType, mode: 'resume' | 'restart') => {
    if (!projectId) return;

    setIsAutoGeneratingSafe(true);
    setAutoStatusSafe('記事を保存中...');
    setErrorSafe(null);
    autoCancelRef.current = false;

    try {
      const project = await window.electronAPI.project.load(projectId);
      if (project.autoGenerationStatus?.running) {
        setProjectSafe(project);
        setAutoStatusSafe(project.autoGenerationStatus.step ?? '自動生成中...');
        setIsAutoGeneratingSafe(true);
        setErrorSafe('既に自動生成中です');
        return;
      }
      const startedAt = new Date().toISOString();
      if (mode === 'restart') {
        project.parts = [];
        project.prompts = [];
        project.images = [];
        project.audio = [];
        project.updatedAt = startedAt;
        await window.electronAPI.project.save(project);
        setProjectSafe(project);
      }
      project.article = {
        title: data.title,
        source: data.source,
        bodyText: data.bodyText,
        importedImages: images,
      };
      await updateAutoStatus(project, {
        running: true,
        step: '記事を保存中...',
        startedAt,
        cancelRequested: false,
        error: undefined,
        finishedAt: undefined,
        steps:
          mode === 'restart'
            ? { script: false, prompts: false, images: false, audio: false, video: false }
            : undefined,
        clearLastVideoPath: mode === 'restart',
      });
      await ensureNotCancelled();

      const computeStepState = (p: Project) => {
        const parts = p.parts ?? [];
        const total = parts.length;
        const script = total > 0;
        const partIdSet = new Set(parts.map((part) => part.id));
        const promptsCount = p.prompts
          ? new Set(p.prompts.filter((prompt) => partIdSet.has(prompt.partId)).map((p) => p.partId))
              .size
          : 0;
        const prompts = script && promptsCount === total;
        const images = script && parts.every((part) => (part.panelImages?.length ?? 0) > 0);
        const audio = script && parts.every((part) => Boolean(part.audio));
        const video = Boolean(p.autoGenerationStatus?.lastVideoPath);
        return { script, prompts, images, audio, video };
      };

      let steps = computeStepState(project);
      await updateAutoStatus(project, { running: true, steps });

      if (!steps.script) {
        await updateAutoStatus(project, { running: true, step: 'スクリプトを生成中...' });
        const scriptResult = await window.electronAPI.ai.generateScript(project.article, {
          tone: 'news',
          targetPartCount,
        });
        await ensureNotCancelled();
        const scriptUsage = createOpenAIUsageRecord('script_generate', scriptResult.usage);
        project.parts = scriptResult.parts;
        if (scriptUsage) {
          project.usage = [...(project.usage ?? []), scriptUsage];
        }
        project.updatedAt = new Date().toISOString();
        await window.electronAPI.project.save(project);
        setProjectSafe(project);
        steps = computeStepState(project);
        await updateAutoStatus(project, {
          running: true,
          step: 'スクリプト完了',
          steps: { script: true },
        });
        await ensureNotCancelled();
      }

      if (!steps.prompts) {
        const partIdSet = new Set(project.parts.map((part) => part.id));
        const promptsByPart = new Set(
          project.prompts.filter((prompt) => partIdSet.has(prompt.partId)).map((p) => p.partId)
        );
        const missingParts = project.parts.filter((part) => !promptsByPart.has(part.id));

        if (missingParts.length > 0) {
          await updateAutoStatus(project, { running: true, step: '画像プロンプトを生成中...' });
          const promptResult = await window.electronAPI.ai.generateImagePrompts(
            missingParts,
            project.article,
            'news_broadcast'
          );
          await ensureNotCancelled();
          const promptUsage = createOpenAIUsageRecord('image_prompt_generate', promptResult.usage);
          project.prompts = [...project.prompts, ...promptResult.prompts];
          if (promptUsage) {
            project.usage = [...(project.usage ?? []), promptUsage];
          }
          project.updatedAt = new Date().toISOString();
          await window.electronAPI.project.save(project);
          setProjectSafe(project);
        }
        steps = computeStepState(project);
        await updateAutoStatus(project, {
          running: true,
          step: '画像プロンプト完了',
          steps: { prompts: true },
        });
        await ensureNotCancelled();
      }

      if (!steps.images) {
        await updateAutoStatus(project, { running: true, step: '画像を生成中...' });
        const partById = new Map(project.parts.map((p) => [p.id, p]));
        const latestPromptByPart = new Map<string, (typeof project.prompts)[number]>();
        for (const prompt of project.prompts) {
          if (!partById.has(prompt.partId)) continue;
          const current = latestPromptByPart.get(prompt.partId);
          if (!current || prompt.createdAt >= current.createdAt) {
            latestPromptByPart.set(prompt.partId, prompt);
          }
        }

        const imagesByPrompt = new Map<string, ImageAsset>();
        for (const image of project.images) {
          if (image.metadata.promptId && !imagesByPrompt.has(image.metadata.promptId)) {
            imagesByPrompt.set(image.metadata.promptId, image);
          }
        }

        const now = new Date().toISOString();
        const nextPartsById = new Map(project.parts.map((p) => [p.id, p]));
        const promptsToGenerate: typeof project.prompts = [];

        for (const part of project.parts) {
          if ((part.panelImages?.length ?? 0) > 0) continue;
          const prompt = latestPromptByPart.get(part.id);
          if (!prompt) continue;
          const existingImage = imagesByPrompt.get(prompt.id);
          if (existingImage) {
            nextPartsById.set(part.id, {
              ...part,
              panelImages: [{ imageId: existingImage.id }],
              updatedAt: now,
            });
          } else {
            promptsToGenerate.push(prompt);
          }
        }

        let imageAssets: ImageAsset[] = [];
        if (promptsToGenerate.length > 0) {
          imageAssets = await window.electronAPI.image.generateBatch(promptsToGenerate, projectId);
          await ensureNotCancelled();
        }

        const imageUsage = createGeminiImageUsageRecord(imageAssets.length, 'image_generate_batch');

        const promptById = new Map(promptsToGenerate.map((p) => [p.id, p]));
        for (const imageAsset of imageAssets) {
          const promptId = imageAsset.metadata.promptId;
          if (!promptId) continue;
          const p = promptById.get(promptId);
          if (!p) continue;
          const part = nextPartsById.get(p.partId);
          if (!part) continue;
          if ((part.panelImages?.length ?? 0) > 0) continue;
          nextPartsById.set(p.partId, {
            ...part,
            panelImages: [{ imageId: imageAsset.id }],
            updatedAt: now,
          });
        }

        project.parts = project.parts.map((p) => nextPartsById.get(p.id) ?? p);
        project.images = [...project.images, ...imageAssets];
        if (imageUsage) {
          project.usage = [...(project.usage ?? []), imageUsage];
        }
        project.updatedAt = now;
        await window.electronAPI.project.save(project);
        setProjectSafe(project);
        steps = computeStepState(project);
        await updateAutoStatus(project, {
          running: true,
          step: '画像生成完了',
          steps: { images: true },
        });
        await ensureNotCancelled();
      }

      if (!steps.audio) {
        await updateAutoStatus(project, { running: true, step: '音声を生成中...' });
        const settings = await window.electronAPI.settings.get();
        await ensureNotCancelled();
        const ttsOptions = buildTtsOptions(settings);
        const nextAudioAssets = [...project.audio];
        const nextParts = project.parts.map((p) => ({ ...p }));
        const audioUsageRecords = [];

        for (const part of nextParts) {
          await ensureNotCancelled();
          if (part.audio) continue;
          const result = await window.electronAPI.tts.generate(
            part.scriptText,
            ttsOptions,
            projectId
          );
          await ensureNotCancelled();
          const usageRecord = createGeminiTtsUsageRecord('tts_generate', result.usage);
          if (usageRecord) audioUsageRecords.push(usageRecord);
          part.audio = result.audio;
          part.updatedAt = new Date().toISOString();
          nextAudioAssets.push(result.audio);
        }

        if (audioUsageRecords.length > 0) {
          project.usage = [...(project.usage ?? []), ...audioUsageRecords];
        }
        project.audio = nextAudioAssets;
        project.parts = nextParts;
        project.updatedAt = new Date().toISOString();
        await window.electronAPI.project.save(project);
        setProjectSafe(project);
        steps = computeStepState(project);
        await updateAutoStatus(project, {
          running: true,
          step: '音声生成完了',
          steps: { audio: true },
        });
        await ensureNotCancelled();
      }

      steps = computeStepState(project);
      if (!steps.video) {
        await updateAutoStatus(project, { running: true, step: '動画を書き出し中...' });
        const settings = await window.electronAPI.settings.get();
        const videoOptions = resolveVideoOptions(settings, project);
        await ensureNotCancelled();
        const renderResult = await window.electronAPI.video.render(
          project,
          videoOptions.renderOptions,
          videoOptions.outputPath
        );
        await updateAutoStatus(project, {
          running: false,
          step: '完了',
          cancelRequested: false,
          steps: { video: true },
          lastVideoPath: renderResult.outputPath,
        });
        notifyCompletion(`動画の生成が完了しました: ${renderResult.outputPath}`);
      } else {
        await updateAutoStatus(project, { running: false, step: '完了', cancelRequested: false });
        notifyCompletion('既に動画まで生成済みのため、再生成はスキップしました。');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '自動生成に失敗しました';
      if (message.includes('キャンセル')) {
        setErrorSafe('キャンセルしました');
        if (projectId) {
          try {
            const latest = await window.electronAPI.project.load(projectId);
            await updateAutoStatus(latest, {
              running: false,
              step: 'キャンセル',
              cancelRequested: false,
            });
          } catch {
            // ignore
          }
        }
      } else {
        console.error('Auto generation failed:', err);
        setErrorSafe(message);
        if (projectId) {
          try {
            const latest = await window.electronAPI.project.load(projectId);
            await updateAutoStatus(latest, {
              running: false,
              step: 'エラー',
              error: message,
              cancelRequested: false,
            });
          } catch {
            // ignore
          }
        }
      }
    } finally {
      setIsAutoGeneratingSafe(false);
      setAutoStatusSafe(null);
      autoCancelRef.current = false;
    }
  };

  const handleAutoCancel = async () => {
    if (!projectId) return;
    autoCancelRef.current = true;
    setAutoStatusSafe('キャンセル中...');
    try {
      const latest = await window.electronAPI.project.load(projectId);
      if (latest.autoGenerationStatus?.running) {
        const now = new Date().toISOString();
        latest.autoGenerationStatus = {
          ...latest.autoGenerationStatus,
          running: true,
          step: 'キャンセル中...',
          updatedAt: now,
          cancelRequested: true,
        };
        latest.updatedAt = now;
        await window.electronAPI.project.save(latest);
        setProjectSafe(latest);
      }
      await window.electronAPI.video.cancelRender();
    } catch {
      // ignore
    }
  };

  const handleAutoResume = async (data: ArticleInputType) => {
    await handleAutoSubmit(data, 'resume');
  };

  const handleAutoRestart = async (data: ArticleInputType) => {
    await handleAutoSubmit(data, 'restart');
  };

  const autoRunning = Boolean(isAutoGenerating || project?.autoGenerationStatus?.running);
  const currentAutoStatus = autoStatus ?? project?.autoGenerationStatus?.step;
  const summary = useMemo(() => (project ? summarizeProjectProgress(project) : null), [project]);

  const handleImportedText = (title: string, text: string) => {
    setArticleData((prev) => ({
      ...prev,
      title: prev.title && prev.title.trim().length > 0 ? prev.title : title,
      bodyText: text,
    }));
  };

  const handleImagesAdded = (added: ImageAsset[], addedBlobUrls: Map<string, string>) => {
    setImages((prev) => [...prev, ...added]);
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
      <Header
        title="記事"
        subtitle={project?.name}
        statusLabel={summary ? `次: ${stageLabel(summary.stage)}` : undefined}
        statusTone="info"
      />

      {projectId && <WorkflowNav projectId={projectId} current="article" project={project} />}

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            {error && (
              <div className="rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Card title="スクリプト生成設定" subtitle="記事入力後のパート分割数を指定">
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-sm font-medium text-slate-700">パート数</label>
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
              <p className="mt-2 text-xs text-slate-500">
                画像を分けたい場合はパート数を増やしてください（後から編集可能）。
              </p>
            </Card>

            <Card title="記事情報" subtitle="必須項目を入力してスクリプトを生成">
              <ArticleInput
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
            <Card title="進行状況" subtitle="次に行う作業と不足項目">
              <div className="space-y-2 text-sm text-slate-600">
                {summary && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <StatusChip
                        tone={summary.hasVideoOutput ? 'success' : 'info'}
                        label={`次: ${stageLabel(summary.stage)}`}
                      />
                      <Badge tone={summary.hasVideoOutput ? 'success' : 'warning'}>
                        {summary.completedSteps}/{summary.totalSteps}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      推奨アクション: {nextActionLabel(summary)}
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <Badge tone="warning">未プロンプト {summary.missingPrompts}</Badge>
                      <Badge tone="warning">未画像 {summary.missingImages}</Badge>
                      <Badge tone="warning">未音声 {summary.missingAudio}</Badge>
                    </div>
                  </>
                )}
                {autoRunning && currentAutoStatus && (
                  <div className="rounded-[8px] border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    自動生成中: {currentAutoStatus}
                  </div>
                )}
              </div>
            </Card>

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
