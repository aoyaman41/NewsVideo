import { resolutionForAspect } from '../../shared/project/videoFormat';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  type Project,
  type Part,
  type ImageAsset,
  type ImagePrompt,
  type AudioAsset,
  type UsageRecord,
} from '../../shared/project/schema';
import { type GenerationJob, classifyGenerationError } from '../../shared/project/jobs';
import {
  inputFingerprint,
  partFreshness,
  sourceInputs,
  isVideoCurrent,
  videoInput,
} from '../../shared/project/integrity';
import {
  estimateGenerationUsd,
  type GenerationOperation,
} from '../../shared/project/generationEstimate';
import { resolvePresentationClosingLine } from '../../shared/project/presentationProfile';
import { normalizeSettings, type AppSettings } from '../../shared/settings/appSettings';
import { normalizeCostRates, estimateUsageCostUsd } from '../../src/utils/cost';
import {
  createOpenAIUsageRecord,
  createImageUsageRecordFromAssets,
  createGeminiTtsUsageRecord,
} from '../../src/utils/usage';
import { ProjectRepository } from '../project/repository';
import { generationSettings } from '../utils/generationContext';

type Usage = Parameters<typeof createOpenAIUsageRecord>[1];
type Invoke = <T>(name: string, ...args: unknown[]) => Promise<T>;
type StartOptions = {
  mode: 'automatic' | 'review';
  targetPartCount: number;
  budgetUsd?: number;
  restart?: boolean;
};
class JobPaused extends Error {}

export class GenerationJobEngine {
  private starting = new Set<string>();
  private running = new Map<string, Promise<void>>();
  private cancellations = new Set<string>();
  constructor(
    private repository: ProjectRepository,
    private invoke: Invoke,
    private settings: () => Promise<AppSettings>,
    private notify: (project: Project) => void
  ) {}

  private async save(project: Project) {
    const saved = await this.repository.save(project);
    this.notify(saved);
    return saved;
  }

  private async commit(id: string, mutate: (project: Project) => void) {
    const saved = await this.repository.update(id, mutate);
    this.notify(saved);
    return saved;
  }

  async recover() {
    for (const directory of await this.repository.directories()) {
      try {
        const project = await this.repository.readDirectory(directory);
        if (project.job && ['queued', 'running'].includes(project.job.status)) {
          if (
            project.job.pendingOperation &&
            !(
              project.job.pendingOperation.kind === 'audio' &&
              project.job.settings.ttsEngine === 'macos_tts'
            )
          )
            project.job.unknownCharges++;
          project.job.pendingOperation = undefined;
          project.job.status = 'interrupted';
          project.job.stage = '再起動後の再開待ち';
          project.autoGenerationStatus = {
            ...project.autoGenerationStatus,
            running: false,
            step: project.job.stage,
          };
          await this.save(project);
        }
      } catch {
        /* Damaged projects remain visible through project:list. */
      }
    }
  }

  async start(id: string, options: StartOptions) {
    if (this.running.has(id) || this.starting.has(id))
      throw new Error('このプロジェクトは生成中です。');
    this.starting.add(id);
    try {
      let project = await this.repository.load(id);
      if (!project.article.title.trim() || !project.article.bodyText.trim())
        throw new Error('記事タイトルと本文を入力してください。');
      const previous = project.job;
      const settings =
        previous && !options.restart && previous.status !== 'completed'
          ? normalizeSettings(previous.settings)
          : await this.settings();
      const now = new Date().toISOString();
      const resume = previous && !options.restart && previous.status !== 'completed';
      const job: GenerationJob = resume
        ? {
            ...previous,
            status: 'queued',
            mode: options.mode,
            budgetUsd: options.budgetUsd,
            error: undefined,
            cancelRequested: false,
            updatedAt: now,
            reviewedStages:
              previous.status === 'paused'
                ? [...previous.reviewedStages, previous.stage]
                : previous.reviewedStages,
          }
        : {
            id: randomUUID(),
            status: 'queued',
            stage: '準備',
            mode: options.mode,
            targetPartCount: options.targetPartCount,
            startedAt: now,
            updatedAt: now,
            completed: [],
            outputs: [],
            reviewedStages: [],
            cancelRequested: false,
            settings: { ...settings, restartScript: Boolean(options.restart) },
            budgetUsd: options.budgetUsd,
            spentUsd: 0,
            estimatedRemainingUsd: 0,
            unknownCharges: 0,
          };
      project.job = job;
      project.generationConfig = {
        ...settings,
        cost: undefined,
        openingVideoPath: undefined,
        endingVideoPath: undefined,
        defaultProjectDir: undefined,
      };
      project = await this.save(project);
      this.cancellations.delete(id);
      const operation = generationSettings.run(settings, () => this.run(id, settings));
      this.running.set(id, operation);
      void operation.finally(() => this.running.delete(id)).catch(() => {});
      return project.job!;
    } finally {
      this.starting.delete(id);
    }
  }

  async cancel(id: string) {
    this.cancellations.add(id);
    await this.commit(id, (project) => {
      if (!project.job) return;
      project.job.cancelRequested = true;
      project.job.stage = '実行中の処理を保存して停止';
      project.autoGenerationStatus = {
        ...project.autoGenerationStatus,
        running: this.running.has(id),
        cancelRequested: true,
        step: project.job.stage,
      };
    });
  }

  async wait(id: string) {
    await this.running.get(id);
  }

  private async checkpoint(id: string, stage: string) {
    return this.commit(id, (project) => {
      if (!project.job) throw new Error('ジョブが見つかりません。');
      if (this.cancellations.has(id) || project.job.cancelRequested)
        throw new Error('キャンセルしました');
      project.job.stage = stage;
      project.job.status = 'running';
      project.job.updatedAt = new Date().toISOString();
      project.autoGenerationStatus = {
        ...project.autoGenerationStatus,
        running: true,
        step: stage,
        cancelRequested: false,
        error: undefined,
      };
    });
  }

  private async review(id: string, stage: string) {
    const project = await this.repository.load(id);
    if (project.job?.mode === 'review' && !project.job.reviewedStages.includes(stage)) {
      project.job.status = 'paused';
      project.job.stage = stage;
      project.autoGenerationStatus = {
        ...project.autoGenerationStatus,
        running: false,
        step: stage,
      };
      await this.save(project);
      throw new JobPaused();
    }
  }

  private async request<T>(
    id: string,
    step: string,
    kind: GenerationOperation,
    source: Project,
    input: string,
    call: () => Promise<T>,
    apply: (project: Project, result: T) => UsageRecord | null,
    signature: (project: Project) => string
  ) {
    const settings = normalizeSettings(source.job!.settings);
    const allowance =
      estimateGenerationUsd(
        kind,
        input,
        settings,
        kind === 'script' ? source.job!.targetPartCount : 1
      ) * 2;
    const job = source.job!;
    if (
      job.budgetUsd !== undefined &&
      (job.unknownCharges > 0 || job.spentUsd + allowance > job.budgetUsd)
    ) {
      job.status = 'paused';
      job.stage = '予算確認';
      job.estimatedRemainingUsd = allowance;
      source.autoGenerationStatus = {
        ...source.autoGenerationStatus,
        running: false,
        step: '予算確認',
      };
      await this.save(source);
      throw new JobPaused();
    }
    const expected = signature(source);
    await this.commit(id, (latest) => {
      latest.job!.pendingOperation = { step, kind, estimatedUsd: allowance };
    });
    const result = await call();
    let inputChanged = false;
    await this.commit(id, (latest) => {
      inputChanged = signature(latest) !== expected;
      latest.job!.pendingOperation = undefined;
      latest.job!.outputs.push({ step, payload: result, createdAt: new Date().toISOString() });
      const usage = inputChanged ? apply(structuredClone(source), result) : apply(latest, result);
      if (usage) {
        usage.jobId = latest.job!.id;
        latest.usage.push(usage);
        latest.job!.spentUsd += estimateUsageCostUsd(usage, normalizeCostRates(settings.cost));
      }
      if (
        (!usage || !(usage.inputTokens || usage.outputTokens)) &&
        !(kind === 'audio' && settings.ttsEngine === 'macos_tts')
      )
        latest.job!.unknownCharges++;
      if (!inputChanged) latest.job!.completed = [...new Set([...latest.job!.completed, step])];
    });
    if (inputChanged)
      throw new Error('生成中に入力が変更されました。生成結果はジョブ履歴に保全しています。');
  }

  private async run(id: string, settings: AppSettings) {
    try {
      let project = await this.checkpoint(id, '台本');
      if (
        (project.job!.settings.restartScript && !project.job!.completed.includes('script')) ||
        !project.parts.length ||
        project.parts.some((part) => partFreshness(project, part).script !== 'current')
      ) {
        await this.request(
          id,
          'script',
          'script',
          project,
          project.article.bodyText,
          () =>
            this.invoke<{ parts: Part[]; usage: Usage }>('ai:generateScript', project.article, {
              tone: project.presentationProfile.tone,
              targetPartCount: project.job!.targetPartCount,
              targetDurationPerPartSec: project.presentationProfile.targetDurationPerPartSec,
              closingLine: resolvePresentationClosingLine(project.presentationProfile),
            }),
          (latest, result) => {
            latest.parts = result.parts;
            return createOpenAIUsageRecord('script_generate', result.usage);
          },
          (latest) => inputFingerprint([latest.article, latest.presentationProfile])
        );
      }
      await this.review(id, '台本の確認');
      project = await this.repository.load(id);
      for (const partId of project.parts.map((part) => part.id)) {
        project = await this.checkpoint(id, '画像');
        let part = project.parts.find((item) => item.id === partId)!;
        if (partFreshness(project, part).image === 'current') continue;
        if (partFreshness(project, part).prompt !== 'current') {
          const source = project;
          await this.request(
            id,
            `prompt:${partId}`,
            'prompt',
            source,
            part.scriptText,
            () =>
              this.invoke<{ prompt: ImagePrompt; usage: Usage }>(
                'ai:generateImagePromptForTarget',
                source.parts,
                source.article,
                partId,
                {
                  stylePreset: source.presentationProfile.imageStylePreset,
                  aspectRatio: source.presentationProfile.aspectRatio,
                  styleReferenceImageIds: source.presentationProfile.styleReferenceImageIds,
                  styleReferenceNote: source.presentationProfile.styleReferenceNote,
                }
              ),
            (latest, result) => {
              latest.prompts.push(result.prompt);
              return createOpenAIUsageRecord('image_prompt_generate', result.usage);
            },
            (latest) =>
              sourceInputs(latest, latest.parts.find((item) => item.id === partId)!).prompt
          );
        }
        project = await this.checkpoint(id, '画像');
        part = project.parts.find((item) => item.id === partId)!;
        const prompt = project.prompts
          .filter((item) => item.partId === partId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        await this.request(
          id,
          `image:${partId}`,
          'image',
          project,
          prompt.prompt,
          () => this.invoke<ImageAsset>('image:generate', prompt, id),
          (latest, image) => {
            latest.images.push(image);
            latest.parts.find((item) => item.id === partId)!.panelImages = [{ imageId: image.id }];
            return createImageUsageRecordFromAssets([image], 'image_generate');
          },
          (latest) => sourceInputs(latest, latest.parts.find((item) => item.id === partId)!).image
        );
      }
      project = await this.repository.load(id);
      for (const partId of project.parts.map((part) => part.id)) {
        project = await this.checkpoint(id, '音声');
        const part = project.parts.find((item) => item.id === partId)!;
        if (partFreshness(project, part).audio === 'current') continue;
        await this.request(
          id,
          `audio:${partId}`,
          'audio',
          project,
          part.scriptText,
          () =>
            this.invoke<{ audio: AudioAsset; usage: Usage }>(
              'tts:generate',
              part.scriptText,
              {
                ttsEngine: settings.ttsEngine,
                ttsModel: settings.ttsModel,
                voiceName: settings.ttsVoice,
                languageCode: 'ja-JP',
                speakingRate: settings.ttsSpeakingRate,
                pitch: settings.ttsPitch,
                audioEncoding: 'MP3',
                narrationStylePreset: project.presentationProfile.ttsNarrationStylePreset,
                narrationStyleNote: project.presentationProfile.ttsNarrationStyleNote,
              },
              id
            ),
          (latest, result) => {
            latest.audio.push(result.audio);
            latest.parts.find((item) => item.id === partId)!.audio = result.audio;
            return createGeminiTtsUsageRecord('tts_generate', result.usage);
          },
          (latest) => sourceInputs(latest, latest.parts.find((item) => item.id === partId)!).audio
        );
      }
      await this.review(id, '素材と公開内容の確認');
      project = await this.checkpoint(id, '動画');
      project.outputSettings = {
        resolution: resolutionForAspect(settings.videoResolution, project.presentationProfile.aspectRatio),
        fps: settings.videoFps,
        videoBitrate: settings.videoBitrate,
        audioBitrate: settings.audioBitrate,
        includeOpening: Boolean(settings.openingVideoPath),
        includeEnding: Boolean(settings.endingVideoPath),
      };
      project = await this.save(project);
      if (!isVideoCurrent(project)) {
        const expected = videoInput(project);
        const output = await this.invoke<{ outputPath: string }>(
          'video:render',
          project,
          project.outputSettings,
          path.join(project.path, 'output', `${project.name.replace(/[\\/:*?"<>|]/g, '_')}.mp4`)
        );
        project = await this.repository.load(id);
        project.job!.outputs.push({
          step: 'video',
          payload: output,
          createdAt: new Date().toISOString(),
        });
        project.integrity = { ...project.integrity!, video: expected };
        project.autoGenerationStatus = {
          ...project.autoGenerationStatus,
          running: false,
          lastVideoPath: output.outputPath,
          finishedAt: new Date().toISOString(),
        };
        project = await this.save(project);
      }
      if (!isVideoCurrent(project))
        throw new Error(
          '生成中に入力が変更されました。動画は保全されていますが再書き出しが必要です。'
        );
      project = await this.checkpoint(id, '完了');
      project.job!.status = 'completed';
      project.job!.estimatedRemainingUsd = 0;
      project.autoGenerationStatus = {
        ...project.autoGenerationStatus,
        running: false,
        step: '完了',
        finishedAt: new Date().toISOString(),
      };
      await this.save(project);
    } catch (error) {
      if (error instanceof JobPaused) return;
      const project = await this.repository.load(id);
      if (!project.job) return;
      project.job.error = classifyGenerationError(error);
      if (
        project.job.pendingOperation &&
        ['transient', 'rate_limit', 'storage'].includes(project.job.error.kind)
      )
        project.job.unknownCharges++;
      project.job.pendingOperation = undefined;
      project.job.status = project.job.error.kind === 'cancelled' ? 'cancelled' : 'failed';
      project.autoGenerationStatus = {
        ...project.autoGenerationStatus,
        running: false,
        step: project.job.status === 'cancelled' ? '停止しました' : '処理に失敗しました',
        error: project.job.error.message,
      };
      await this.save(project);
    }
  }
}
