import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ArticleInput, FileImport, ImageDropzone } from '../components/article';
import { Badge, Card, ErrorDetailPanel, StatusChip, useToast } from '../components/ui';
import type {
  ArticleInput as ArticleInputType,
  AutoGenerationStatus,
  ImageAsset,
  PresentationProfile,
  Project,
} from '../schemas';
import {
  createGeminiImageUsageRecordFromAssets,
  createGeminiTtsUsageRecord,
  createOpenAIUsageRecord,
} from '../utils/usage';
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
  DEFAULT_GEMINI_TTS_MODEL,
  type GeminiTtsModel,
} from '../../shared/constants/models';
import {
  TTS_NARRATION_STYLE_DESCRIPTIONS,
  TTS_NARRATION_STYLE_LABELS,
  TTS_NARRATION_STYLE_PRESETS,
} from '../../shared/project/ttsNarrationStyles';

export function ArticleInputPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

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
  const [presentationProfile, setPresentationProfile] = useState<PresentationProfile>(
    getDefaultPresentationProfile()
  );
  const autoCancelRef = useRef(false);
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

  const reportInfo = useCallback(
    (message: string, title?: string) => {
      if (!isMountedRef.current) return;
      setError(null);
      toast.info(message, title);
    },
    [toast]
  );

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
        const normalizedProfile = normalizePresentationProfile(project.presentationProfile);
        setPresentationProfile(normalizedProfile);
        savedPresentationProfileRef.current = JSON.stringify(normalizedProfile);
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
  }, [projectId, reportError]);

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
        await window.electronAPI.project.save(updatedProject);
        savedPresentationProfileRef.current = serialized;
        setProjectSafe(updatedProject);
      } catch (err) {
        console.error('Failed to save presentation profile:', err);
        reportError(
          err instanceof Error ? err.message : '表現設定の保存に失敗しました',
          '表現設定の保存に失敗しました'
        );
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [presentationProfile, project, reportError]);

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
      toast.success(message, '自動生成完了');
      return;
    }

    if (Notification.permission === 'granted') {
      new Notification('自動生成完了', { body: message });
      toast.success(message, '自動生成完了');
      return;
    }

    if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          new Notification('自動生成完了', { body: message });
        } else {
          toast.success(message, '自動生成完了');
        }
      });
      return;
    }

    toast.success(message, '自動生成完了');
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
    ttsModel?: GeminiTtsModel;
    ttsVoice?: string;
    ttsSpeakingRate?: number;
    ttsPitch?: number;
  }, profile: PresentationProfile) => {
    const voiceName = settings.ttsVoice || 'Charon';
    const match = voiceName.match(/^([a-z]{2}-[A-Z]{2})/);
    const languageCode = match?.[1] || 'ja-JP';

    return {
      ttsEngine: (settings.ttsEngine as 'google_tts' | 'gemini_tts' | 'macos_tts') || 'gemini_tts',
      ttsModel: settings.ttsModel || DEFAULT_GEMINI_TTS_MODEL,
      voiceName,
      languageCode,
      speakingRate: Number.isFinite(settings.ttsSpeakingRate) ? settings.ttsSpeakingRate! : 1.0,
      pitch: Number.isFinite(settings.ttsPitch) ? settings.ttsPitch! : 0,
      audioEncoding: 'MP3' as const,
      narrationStylePreset: profile.ttsNarrationStylePreset,
      narrationStyleNote: profile.ttsNarrationStyleNote,
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
  const imageStyleDescription = IMAGE_STYLE_PRESET_DESCRIPTIONS[presentationProfile.imageStylePreset];
  const ttsStyleDescription =
    TTS_NARRATION_STYLE_DESCRIPTIONS[presentationProfile.ttsNarrationStylePreset];

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
      project.presentationProfile = presentationProfile;
      project.updatedAt = new Date().toISOString();
      await window.electronAPI.project.save(project);

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
      await window.electronAPI.project.save(project);

      // スクリプト編集画面に遷移
      navigate(`/projects/${projectId}/script`);
    } catch (err) {
      console.error('Script generation failed:', err);
      reportError(err instanceof Error ? err.message : 'スクリプト生成に失敗しました');
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
        reportInfo('既に自動生成中です。進行状況をそのまま表示します。', '既に実行中です');
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
      project.presentationProfile = presentationProfile;
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
          tone: presentationProfile.tone,
          targetPartCount,
          targetDurationPerPartSec: presentationProfile.targetDurationPerPartSec,
          closingLine: closingLinePreview,
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

      const needsImagePipeline = !steps.prompts || !steps.images;
      const needsAudioPipeline = !steps.audio;

      type ImagePipelineResult = {
        promptsAdded: Project['prompts'];
        imagesAdded: ImageAsset[];
        partImageById: Map<string, string>;
        usageRecords: Project['usage'];
      };

      type AudioPipelineResult = {
        audioAdded: Project['audio'];
        partAudioById: Map<string, Project['audio'][number]>;
        usageRecords: Project['usage'];
        errors: string[];
      };

      const runImagePipeline = async (baseProject: Project): Promise<ImagePipelineResult> => {
        const usageRecords: Project['usage'] = [];
        const partById = new Map(baseProject.parts.map((part) => [part.id, part]));
        const existingPrompts = baseProject.prompts.filter((prompt) => partById.has(prompt.partId));
        const promptsByPart = new Set(existingPrompts.map((prompt) => prompt.partId));
        const missingParts = baseProject.parts.filter((part) => !promptsByPart.has(part.id));

        let promptsAdded: Project['prompts'] = [];
        if (missingParts.length > 0) {
          const promptResult = await window.electronAPI.ai.generateImagePrompts(
            missingParts,
            baseProject.article,
            {
              stylePreset: baseProject.presentationProfile.imageStylePreset,
              aspectRatio: baseProject.presentationProfile.aspectRatio,
            }
          );
          await ensureNotCancelled();
          promptsAdded = promptResult.prompts;
          const promptUsage = createOpenAIUsageRecord('image_prompt_generate', promptResult.usage);
          if (promptUsage) usageRecords.push(promptUsage);
        }

        const partImageById = new Map<string, string>();
        let imagesAdded: ImageAsset[] = [];
        if (!steps.images) {
          const allPrompts = [...existingPrompts, ...promptsAdded];
          const latestPromptByPart = new Map<string, (typeof allPrompts)[number]>();
          for (const prompt of allPrompts) {
            const current = latestPromptByPart.get(prompt.partId);
            if (!current || prompt.createdAt >= current.createdAt) {
              latestPromptByPart.set(prompt.partId, prompt);
            }
          }

          const imagesByPrompt = new Map<string, ImageAsset>();
          for (const image of baseProject.images) {
            if (image.metadata.promptId && !imagesByPrompt.has(image.metadata.promptId)) {
              imagesByPrompt.set(image.metadata.promptId, image);
            }
          }

          const promptsToGenerate: Project['prompts'] = [];
          for (const part of baseProject.parts) {
            if ((part.panelImages?.length ?? 0) > 0) continue;
            const prompt = latestPromptByPart.get(part.id);
            if (!prompt) continue;
            const existingImage = imagesByPrompt.get(prompt.id);
            if (existingImage) {
              partImageById.set(part.id, existingImage.id);
            } else {
              promptsToGenerate.push(prompt);
            }
          }

          if (promptsToGenerate.length > 0) {
            if (!projectId) {
              throw new Error('projectId が指定されていません');
            }
            imagesAdded = await window.electronAPI.image.generateBatch(promptsToGenerate, projectId);
            await ensureNotCancelled();
          }

          const imageUsage = createGeminiImageUsageRecordFromAssets(
            imagesAdded,
            'image_generate_batch'
          );
          if (imageUsage) usageRecords.push(imageUsage);

          const promptById = new Map(promptsToGenerate.map((prompt) => [prompt.id, prompt]));
          for (const imageAsset of imagesAdded) {
            const promptId = imageAsset.metadata.promptId;
            if (!promptId) continue;
            const generatedPrompt = promptById.get(promptId);
            if (!generatedPrompt) continue;
            partImageById.set(generatedPrompt.partId, imageAsset.id);
          }
        }

        return {
          promptsAdded,
          imagesAdded,
          partImageById,
          usageRecords,
        };
      };

      const runAudioPipeline = async (baseProject: Project): Promise<AudioPipelineResult> => {
        const settings = await window.electronAPI.settings.get();
        await ensureNotCancelled();
        const ttsOptions = buildTtsOptions(settings, baseProject.presentationProfile);
        const usageRecords: Project['usage'] = [];
        const partAudioById = new Map<string, Project['audio'][number]>();
        const audioAdded: Project['audio'] = [];
        const errors: string[] = [];
        const targets = baseProject.parts.filter((part) => !part.audio);
        const AUDIO_GENERATION_CONCURRENCY = 5;

        if (!projectId) {
          throw new Error('projectId が指定されていません');
        }

        type AudioTaskResult =
          | {
              ok: true;
              partId: string;
              audio: Project['audio'][number];
              usageRecord: Project['usage'][number] | null;
            }
          | {
              ok: false;
              error: string;
            };

        const taskResults: Array<AudioTaskResult | null> = Array(targets.length).fill(null);
        const workerCount = Math.max(1, Math.min(AUDIO_GENERATION_CONCURRENCY, targets.length));
        let cursor = 0;

        await Promise.all(
          Array.from({ length: workerCount }, async () => {
            while (true) {
              const taskIndex = cursor;
              cursor += 1;
              if (taskIndex >= targets.length) {
                return;
              }

              const part = targets[taskIndex];
              await ensureNotCancelled();
              try {
                const scriptText = part.scriptText?.trim() ?? '';
                if (!scriptText) {
                  throw new Error('スクリプトが空です');
                }
                const result = await window.electronAPI.tts.generate(scriptText, ttsOptions, projectId);
                await ensureNotCancelled();
                const usageRecord = createGeminiTtsUsageRecord('tts_generate', result.usage);
                taskResults[taskIndex] = {
                  ok: true,
                  partId: part.id,
                  audio: result.audio,
                  usageRecord,
                };
              } catch (error) {
                taskResults[taskIndex] = {
                  ok: false,
                  error: `パート${part.index + 1}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                };
              }
            }
          })
        );

        for (const result of taskResults) {
          if (!result) continue;
          if (!result.ok) {
            errors.push(result.error);
            continue;
          }
          if (result.usageRecord) usageRecords.push(result.usageRecord);
          partAudioById.set(result.partId, result.audio);
          audioAdded.push(result.audio);
        }

        return {
          audioAdded,
          partAudioById,
          usageRecords,
          errors,
        };
      };

      if (needsImagePipeline || needsAudioPipeline) {
        const runningStepLabel =
          needsImagePipeline && needsAudioPipeline
            ? '画像と音声を生成中...'
            : needsImagePipeline
              ? '画像を生成中...'
              : '音声を生成中...';
        await updateAutoStatus(project, { running: true, step: runningStepLabel });
        await ensureNotCancelled();

        const [imageSettled, audioSettled] = await Promise.allSettled([
          needsImagePipeline ? runImagePipeline(project) : Promise.resolve(null),
          needsAudioPipeline ? runAudioPipeline(project) : Promise.resolve(null),
        ]);
        await ensureNotCancelled();

        const pipelineErrors: string[] = [];
        const audioErrors: string[] = [];
        const now = new Date().toISOString();

        if (imageSettled.status === 'fulfilled' && imageSettled.value) {
          const imageResult = imageSettled.value;
          if (imageResult.promptsAdded.length > 0) {
            project.prompts = [...project.prompts, ...imageResult.promptsAdded];
          }
          if (imageResult.imagesAdded.length > 0) {
            project.images = [...project.images, ...imageResult.imagesAdded];
          }
          if (imageResult.usageRecords.length > 0) {
            project.usage = [...project.usage, ...imageResult.usageRecords];
          }
          if (imageResult.partImageById.size > 0) {
            project.parts = project.parts.map((part) => {
              const imageId = imageResult.partImageById.get(part.id);
              if (!imageId) return part;
              if ((part.panelImages?.length ?? 0) > 0) return part;
              return {
                ...part,
                panelImages: [{ imageId }],
                updatedAt: now,
              };
            });
          }
        } else if (imageSettled.status === 'rejected') {
          pipelineErrors.push(
            `画像生成に失敗しました: ${
              imageSettled.reason instanceof Error
                ? imageSettled.reason.message
                : String(imageSettled.reason)
            }`
          );
        }

        if (audioSettled.status === 'fulfilled' && audioSettled.value) {
          const audioResult = audioSettled.value;
          audioErrors.push(...audioResult.errors);
          if (audioResult.audioAdded.length > 0) {
            project.audio = [...project.audio, ...audioResult.audioAdded];
          }
          if (audioResult.usageRecords.length > 0) {
            project.usage = [...project.usage, ...audioResult.usageRecords];
          }
          if (audioResult.partAudioById.size > 0) {
            project.parts = project.parts.map((part) => {
              const audio = audioResult.partAudioById.get(part.id);
              if (!audio) return part;
              return {
                ...part,
                audio,
                updatedAt: now,
              };
            });
          }
        } else if (audioSettled.status === 'rejected') {
          pipelineErrors.push(
            `音声生成に失敗しました: ${
              audioSettled.reason instanceof Error
                ? audioSettled.reason.message
                : String(audioSettled.reason)
            }`
          );
        }

        project.updatedAt = now;
        await window.electronAPI.project.save(project);
        setProjectSafe(project);

        steps = computeStepState(project);
        const finishedStepLabel =
          needsImagePipeline && needsAudioPipeline
            ? '画像・音声生成完了'
            : needsImagePipeline
              ? '画像生成完了'
              : '音声生成完了';
        await updateAutoStatus(project, {
          running: true,
          step: finishedStepLabel,
          steps: {
            prompts: steps.prompts,
            images: steps.images,
            audio: steps.audio,
          },
        });
        await ensureNotCancelled();

        if (audioErrors.length > 0) {
          const head = audioErrors.slice(0, 3).join(' / ');
          const tail = audioErrors.length > 3 ? `（他${audioErrors.length - 3}件）` : '';
          throw new Error(`音声生成の一部に失敗しました: ${head}${tail}`);
        }

        if (pipelineErrors.length > 0) {
          throw new Error(pipelineErrors.join(' / '));
        }
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
        reportInfo('自動生成をキャンセルしました。', 'キャンセル');
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
        reportError(message, '自動生成に失敗しました');
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
      <Header title="記事" subtitle={project?.name} />

      {projectId && <WorkflowNav projectId={projectId} current="article" project={project} />}

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            {error && (
              <ErrorDetailPanel message={error} onDismiss={() => setError(null)} />
            )}

            <Card title="生成設定" subtitle="配信スタイルと画像の既定値を指定">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    配信スタイル
                  </label>
                  <select
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
                  <p className="mt-2 text-xs text-slate-500">{presetDescription}</p>
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
                  <p className="mt-2 text-xs text-slate-500">
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
                  <p className="mt-2 text-xs text-slate-500">
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
                  <p className="mt-2 text-xs text-slate-500">
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
                  <p className="mt-2 text-xs text-slate-500">{imageStyleDescription}</p>
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
                  <p className="mt-2 text-xs text-slate-500">
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
                        ttsNarrationStylePreset:
                          e.target.value as PresentationProfile['ttsNarrationStylePreset'],
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
                  <p className="mt-2 text-xs text-slate-500">{ttsStyleDescription}</p>
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
                <p className="mt-2 text-xs text-slate-500">
                  短い補足だけを上書きできます。engine やボイス設定は変更しません。
                </p>
              </div>
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
            <Card title="自動生成" subtitle="記事から動画までをまとめて進行">
              <div className="space-y-3 text-sm text-slate-600">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip
                    tone={autoRunning ? 'info' : 'neutral'}
                    label={autoRunning ? '実行中' : '待機中'}
                  />
                  <Badge tone="info">記事保存 → スクリプト → 画像 → 音声 → 動画</Badge>
                </div>
                <p className="text-xs text-slate-500">
                  上部の Workflow が全体進捗を示します。このカードでは現在の自動生成状態だけを表示します。
                </p>
                <div className="rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 px-3 py-3 text-xs">
                  {autoRunning && currentAutoStatus ? (
                    <span className="text-blue-700">自動生成中: {currentAutoStatus}</span>
                  ) : (
                    <span className="text-slate-600">必要なときに「記事から動画まで自動生成」を実行できます。</span>
                  )}
                </div>
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
