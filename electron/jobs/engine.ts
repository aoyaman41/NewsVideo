import { metricsSchema } from '../../shared/project/metrics';
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
import {
  type GenerationJob,
  type PendingOperation,
  classifyGenerationError,
  pendingOperationsOf,
} from '../../shared/project/jobs';
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
import { getTextCompletionModelProvider } from '../../shared/constants/models';
import { normalizeCostRates, estimateUsageCostUsd } from '../../src/utils/cost';
import {
  createOpenAIUsageRecord,
  createImageUsageRecordFromAssets,
  createGeminiTtsUsageRecord,
} from '../../src/utils/usage';
import { ProjectRepository } from '../project/repository';
import {
  generationSettings,
  jobOperationContext,
  type JobOperationContext,
  type RenderProgress,
} from '../utils/generationContext';
import { concurrencyFor } from '../utils/generationPolicy';
import { replaceLeadImage } from './panelImages';
import { StagePool } from './scheduler';

type Usage = Parameters<typeof createOpenAIUsageRecord>[1];
type Invoke = <T>(name: string, ...args: unknown[]) => Promise<T>;
type StartOptions = {
  mode: 'automatic' | 'review';
  targetPartCount: number;
  budgetUsd?: number;
  restart?: boolean;
};
type EngineOptions = {
  /** 動画の進み具合を保存・通知する最短の間隔(ミリ秒)。これより短い間隔でも 5% 以上進んだら保存する */
  videoProgressIntervalMs?: number;
};
type MaterialKind = 'prompt' | 'image' | 'audio';
type RunHandle = { abort: AbortController; pool?: StagePool<MaterialKind> };
type Operation<T> = {
  step: string;
  kind: GenerationOperation;
  /** 見積もりに使う入力の文字列 */
  input: (project: Project) => string;
  call: (source: Project) => Promise<T>;
  apply: (project: Project, result: T) => UsageRecord | null;
  /** 生成中に入力が変わったかを判定する指紋(パート単位) */
  signature: (project: Project) => string;
  context?: JobOperationContext;
};

class JobPaused extends Error {}
/** 予算の判定で、新しい処理を始めずに止める */
class BudgetExceeded extends Error {
  constructor(readonly allowance: number) {
    super('予算確認');
  }
}

const CANCELLED = 'キャンセルしました';
// 失敗したときに料金が発生した可能性がある(未確定として数える)エラーの種類
const POSSIBLY_CHARGED = ['transient', 'rate_limit', 'storage'];
const VIDEO_PROGRESS_STEP = 5;

function setPendingOperations(job: GenerationJob, operations: PendingOperation[]) {
  job.pendingOperation = undefined;
  job.pendingOperations = operations.length > 0 ? operations : undefined;
}

/**
 * ジョブを止めるときに残っている実行中の記録を片付ける。各処理は成功・失敗のどちらでも自分の記録を外すので、
 * 残っているのは結果の保存に失敗したもの(送信済みで料金が発生したか分からないもの)。未確定として数える
 */
function settleLeftoverOperations(job: GenerationJob) {
  job.unknownCharges += pendingOperationsOf(job).filter(
    (operation) => !isFreeOperation(job, operation.kind)
  ).length;
  setPendingOperations(job, []);
}

function removePendingOperation(job: GenerationJob, step: string) {
  setPendingOperations(
    job,
    pendingOperationsOf(job).filter((operation) => operation.step !== step)
  );
}

/** 料金が発生しない処理(macOS の読み上げ)か */
function isFreeOperation(job: GenerationJob, kind: GenerationOperation) {
  return kind === 'audio' && job.settings.ttsEngine === 'macos_tts';
}

function partOf(project: Project, partId: string): Part {
  const part = project.parts.find((item) => item.id === partId);
  if (!part)
    throw new Error('生成中にシーンの構成が変更されました。最新の内容を確認してください。');
  return part;
}

function latestPrompt(project: Project, partId: string): ImagePrompt {
  const prompt = project.prompts
    .filter((item) => item.partId === partId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!prompt) throw new Error('画像プロンプトが見つかりません。');
  return prompt;
}

/**
 * 動画の進み具合の保存を間引く。保存中は次を始めず、最新の値だけを残す。
 * 前回の保存から interval 以上たったとき、または step 以上進んだときに保存する(取り残した最後の値は後で保存する)
 */
class ProgressSaver {
  private pending: RenderProgress | null = null;
  private saving: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastAt = 0;
  private last: RenderProgress | null = null;
  private closed = false;

  constructor(
    private save: (progress: RenderProgress) => Promise<unknown>,
    private intervalMs: number
  ) {}

  update(progress: RenderProgress) {
    if (this.closed) return;
    if (progress.percent === this.last?.percent && progress.message === this.last?.message) return;
    this.pending = progress;
    this.pump();
  }

  /** 間引いて保存していなかった最後の値も保存してから閉じる(失敗・停止の時点の進み具合を残す) */
  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.saving;
    const last = this.pending;
    this.pending = null;
    if (last) await this.save(last).catch(() => {});
  }

  private pump() {
    if (this.closed || this.saving || !this.pending) return;
    const wait = this.lastAt + this.intervalMs - Date.now();
    const jumped = this.pending.percent - (this.last?.percent ?? 0) >= VIDEO_PROGRESS_STEP;
    if (wait > 0 && !jumped) {
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    const progress = this.pending;
    this.pending = null;
    this.last = progress;
    this.lastAt = Date.now();
    this.saving = this.save(progress)
      .then(
        () => {},
        () => {}
      )
      .finally(() => {
        this.saving = null;
        this.pump();
      });
  }
}

export class GenerationJobEngine {
  private starting = new Set<string>();
  private running = new Map<string, Promise<void>>();
  private cancellations = new Set<string>();
  private handles = new Map<string, RunHandle>();
  constructor(
    private repository: ProjectRepository,
    private invoke: Invoke,
    private settings: () => Promise<AppSettings>,
    private notify: (project: Project) => void,
    private options: EngineOptions = {}
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
          const job = project.job;
          // 結果を受け取る前に終了した処理は、料金が発生したかどうか分からないので未確定として数える
          job.unknownCharges += pendingOperationsOf(job).filter(
            (operation) => !isFreeOperation(job, operation.kind)
          ).length;
          setPendingOperations(job, []);
          job.status = 'interrupted';
          job.stage = '再起動後の再開待ち';
          project.autoGenerationStatus = {
            ...project.autoGenerationStatus,
            running: false,
            step: job.stage,
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
      if (previous && !resume) project.jobHistory = [...(project.jobHistory ?? []), previous];
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
      const handle: RunHandle = { abort: new AbortController() };
      this.handles.set(id, handle);
      const operation = generationSettings.run(settings, () => this.run(id, settings, handle));
      this.running.set(id, operation);
      void operation
        .finally(() => {
          this.running.delete(id);
          if (this.handles.get(id) === handle) this.handles.delete(id);
        })
        .catch(() => {});
      return project.job!;
    } finally {
      this.starting.delete(id);
    }
  }

  async cancel(id: string) {
    this.cancellations.add(id);
    // 新しい処理は始めず(実行中の生成は完了させて保存する)、書き出し中の動画処理は止める
    const handle = this.handles.get(id);
    handle?.pool?.stop(new Error(CANCELLED));
    handle?.abort.abort();
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

  private async checkpoint(id: string, stage: string, mutate?: (project: Project) => void) {
    return this.commit(id, (project) => {
      if (!project.job) throw new Error('ジョブが見つかりません。');
      if (this.cancellations.has(id) || project.job.cancelRequested) throw new Error(CANCELLED);
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
      mutate?.(project);
    });
  }

  private async review(id: string, stage: string) {
    const project = await this.repository.load(id);
    if (project.job?.mode === 'review' && !project.job.reviewedStages.includes(stage)) {
      await this.commit(id, (latest) => {
        latest.job!.status = 'paused';
        latest.job!.stage = stage;
        latest.autoGenerationStatus = {
          ...latest.autoGenerationStatus,
          running: false,
          step: stage,
        };
      });
      throw new JobPaused();
    }
  }

  /**
   * 料金が発生する 1 件の処理。並列に呼ばれる前提で、保存はすべてリビジョンの一致を求めない更新(直列キュー)で行う。
   * 1. 予約: 停止の確認と予算の判定をし、実行中の処理として記録する(見込み額を予約する)
   * 2. 実行
   * 3. 確定: 実行中の記録を外し、結果・使用量・進み具合を保存する。生成中にそのパートの入力が変わっていたら、
   *    結果はジョブ履歴にだけ残してエラーにする
   */
  private async request<T>(id: string, operation: Operation<T>) {
    let source!: Project;
    let expected = '';
    await this.commit(id, (latest) => {
      const job = latest.job!;
      // 停止の指示や、並列の処理の失敗で止めたあとは、新しい処理を始めない(このエラーは記録しない)
      if (
        this.cancellations.has(id) ||
        job.cancelRequested ||
        this.handles.get(id)?.pool?.isStopped
      )
        throw new Error(CANCELLED);
      const settings = normalizeSettings(job.settings);
      const allowance =
        estimateGenerationUsd(
          operation.kind,
          operation.input(latest),
          settings,
          operation.kind === 'script' ? job.targetPartCount : 1
        ) * 2;
      // 予算で止めるのは、確定済みの使用額 + 実行中の処理の予約額 + 次の処理の見込み額(余裕込み)が予算を超えるとき。
      // 料金未確定の記録(unknownCharges)があるだけでは止めない(未確定の件数は画面に表示している)
      const reserved = pendingOperationsOf(job).reduce((sum, item) => sum + item.estimatedUsd, 0);
      if (job.budgetUsd !== undefined && job.spentUsd + reserved + allowance > job.budgetUsd)
        throw new BudgetExceeded(allowance);
      source = structuredClone(latest);
      expected = operation.signature(latest);
      setPendingOperations(job, [
        ...pendingOperationsOf(job),
        { step: operation.step, kind: operation.kind, estimatedUsd: allowance },
      ]);
      latest.metrics = metricsSchema.parse(latest.metrics ?? {});
      latest.metrics.generationRequests++;
    });
    const free = isFreeOperation(source.job!, operation.kind);
    // 予約を保存する間に止めた(停止の指示・並列の処理の失敗)場合は、送らずに予約を外す
    if (this.cancellations.has(id) || this.handles.get(id)?.pool?.isStopped) {
      await this.commit(id, (latest) => removePendingOperation(latest.job!, operation.step)).catch(
        () => {}
      );
      throw new Error(CANCELLED);
    }
    let result: T;
    try {
      result = await (operation.context
        ? jobOperationContext.run(operation.context, () => operation.call(source))
        : operation.call(source));
    } catch (error) {
      // 失敗を先に伝え、保存を待つ間に並列のほかの処理が送られないようにする
      this.handles.get(id)?.pool?.stop(error);
      // 失敗した処理の記録を外す。一時的な失敗や保存の失敗は料金が発生した可能性があるので未確定として数える
      await this.commit(id, (latest) => {
        removePendingOperation(latest.job!, operation.step);
        if (!free && POSSIBLY_CHARGED.includes(classifyGenerationError(error).kind))
          latest.job!.unknownCharges++;
      }).catch(() => {});
      throw error;
    }
    const settings = normalizeSettings(source.job!.settings);
    let inputChanged = false;
    await this.commit(id, (latest) => {
      const job = latest.job!;
      let actual: string | null = null;
      try {
        actual = operation.signature(latest);
      } catch {
        // 生成中にシーンが削除された場合も「入力が変わった」として扱い、結果はジョブ履歴に残す
      }
      inputChanged = actual !== expected;
      removePendingOperation(job, operation.step);
      job.updatedAt = new Date().toISOString();
      job.outputs.push({ step: operation.step, payload: result, createdAt: job.updatedAt });
      const usage = inputChanged
        ? operation.apply(structuredClone(source), result)
        : operation.apply(latest, result);
      if (usage) {
        usage.jobId = job.id;
        latest.usage.push(usage);
        job.spentUsd += estimateUsageCostUsd(usage, normalizeCostRates(settings.cost));
      }
      if ((!usage || !(usage.inputTokens || usage.outputTokens)) && !free) job.unknownCharges++;
      if (!inputChanged) {
        job.completed = [...new Set([...job.completed, operation.step])];
        const progress = job.progress?.[operation.kind];
        if (progress)
          job.progress = {
            ...job.progress,
            [operation.kind]: {
              total: progress.total,
              done: Math.min(progress.total, progress.done + 1),
            },
          };
      }
    });
    if (inputChanged)
      throw new Error('生成中に入力が変更されました。生成結果はジョブ履歴に保全しています。');
  }

  private generateScript(id: string) {
    return this.request<{ parts: Part[]; usage: Usage }>(id, {
      step: 'script',
      kind: 'script',
      input: (project) => project.article.bodyText,
      call: (source) =>
        this.invoke('ai:generateScript', source.article, {
          tone: source.presentationProfile.tone,
          targetPartCount: source.job!.targetPartCount,
          targetDurationPerPartSec: source.presentationProfile.targetDurationPerPartSec,
          closingLine: resolvePresentationClosingLine(source.presentationProfile),
        }),
      apply: (latest, result) => {
        latest.parts = result.parts;
        return createOpenAIUsageRecord('script_generate', result.usage);
      },
      signature: (latest) => inputFingerprint([latest.article, latest.presentationProfile]),
    });
  }

  private generatePrompt(id: string, partId: string, context?: JobOperationContext) {
    return this.request<{ prompt: ImagePrompt; usage: Usage }>(id, {
      step: `prompt:${partId}`,
      kind: 'prompt',
      input: (project) => partOf(project, partId).scriptText,
      call: (source) =>
        this.invoke('ai:generateImagePromptForTarget', source.parts, source.article, partId, {
          stylePreset: source.presentationProfile.imageStylePreset,
          aspectRatio: source.presentationProfile.aspectRatio,
          styleReferenceImageIds: source.presentationProfile.styleReferenceImageIds,
          styleReferenceNote: source.presentationProfile.styleReferenceNote,
        }),
      apply: (latest, result) => {
        latest.prompts.push(result.prompt);
        return createOpenAIUsageRecord('image_prompt_generate', result.usage);
      },
      signature: (latest) => sourceInputs(latest, partOf(latest, partId)).prompt,
      context,
    });
  }

  private generateImage(id: string, partId: string) {
    return this.request<ImageAsset>(id, {
      step: `image:${partId}`,
      kind: 'image',
      input: (project) => latestPrompt(project, partId).prompt,
      call: (source) => this.invoke('image:generate', latestPrompt(source, partId), id),
      apply: (latest, image) => {
        latest.images.push(image);
        // 先頭の枠だけを差し替え、2 枚目以降は残す(1 シーンに複数の画像を置ける)
        const part = partOf(latest, partId);
        part.panelImages = replaceLeadImage(part.panelImages, image.id);
        return createImageUsageRecordFromAssets([image], 'image_generate');
      },
      signature: (latest) => sourceInputs(latest, partOf(latest, partId)).image,
    });
  }

  private generateAudio(id: string, partId: string, settings: AppSettings) {
    return this.request<{ audio: AudioAsset; usage: Usage }>(id, {
      step: `audio:${partId}`,
      kind: 'audio',
      input: (project) => partOf(project, partId).scriptText,
      call: (source) => {
        const part = partOf(source, partId);
        return this.invoke(
          'tts:generate',
          part.narrationText || part.scriptText,
          {
            ttsEngine: settings.ttsEngine,
            ttsModel: settings.ttsModel,
            voiceName: settings.ttsVoice,
            languageCode: 'ja-JP',
            speakingRate: settings.ttsSpeakingRate,
            pitch: settings.ttsPitch,
            audioEncoding: 'MP3',
            narrationStylePreset: source.presentationProfile.ttsNarrationStylePreset,
            narrationStyleNote: source.presentationProfile.ttsNarrationStyleNote,
          },
          id
        );
      },
      apply: (latest, result) => {
        latest.audio.push(result.audio);
        partOf(latest, partId).audio = result.audio;
        return createGeminiTtsUsageRecord('tts_generate', result.usage);
      },
      signature: (latest) => sourceInputs(latest, partOf(latest, partId)).audio,
    });
  }

  /**
   * 画像と音声の工程。台本ができたら、全パートの画像プロンプトと音声を同時に始め、プロンプトができたパートから
   * 画像に進む。同時に走らせる数は用途ごとの枠(generationPolicy と同じ値)で制限する。
   * 1 件でも失敗したら(停止・予算の判定を含む)新しい処理は始めず、実行中の処理の完了と保存を待ってから止める。
   */
  private async materials(id: string, settings: AppSettings, handle: RunHandle) {
    let plan = { prompt: [] as string[], image: [] as string[], audio: [] as string[] };
    await this.checkpoint(id, '画像と音声', (latest) => {
      const parts = [...latest.parts].sort((a, b) => a.index - b.index);
      const fresh = new Map(parts.map((part) => [part.id, partFreshness(latest, part)]));
      const image = parts.filter((part) => fresh.get(part.id)!.image !== 'current');
      plan = {
        image: image.map((part) => part.id),
        prompt: image.filter((part) => fresh.get(part.id)!.prompt !== 'current').map((p) => p.id),
        audio: parts.filter((part) => fresh.get(part.id)!.audio !== 'current').map((p) => p.id),
      };
      const total = parts.length;
      latest.job!.progress = {
        ...latest.job!.progress,
        prompt: { done: total - plan.prompt.length, total },
        image: { done: total - plan.image.length, total },
        audio: { done: total - plan.audio.length, total },
      };
    });
    const pool = new StagePool<MaterialKind>({
      prompt: concurrencyFor('text'),
      image: concurrencyFor('image'),
      audio: concurrencyFor('tts'),
    });
    handle.pool = pool;
    if (this.cancellations.has(id)) pool.stop(new Error(CANCELLED));
    try {
      for (const partId of plan.audio)
        pool.schedule('audio', () => this.generateAudio(id, partId, settings));
      for (const partId of plan.image.filter((item) => !plan.prompt.includes(item)))
        pool.schedule('image', () => this.generateImage(id, partId));
      const promptThenImage = (partId: string, context?: JobOperationContext) =>
        pool.schedule('prompt', async () => {
          try {
            await this.generatePrompt(id, partId, context);
          } catch (error) {
            // 待ち合わせを解く前に止める(失敗を知らずに残りのリクエストを送らないため)
            pool.stop(error);
            throw error;
          } finally {
            context?.onResponseStart?.();
          }
          pool.schedule('image', () => this.generateImage(id, partId));
        });
      const [first, ...rest] = plan.prompt;
      if (first && rest.length > 0 && this.waitsForPromptCache(settings)) {
        // Claude のプロンプトキャッシュは 1 本目の応答が始まってから読めるようになる。同じ記事への残りの
        // リクエストは、1 本目の応答の開始(完了や失敗を含む)を待ってから送る
        let started!: () => void;
        const firstStarted = new Promise<void>((resolve) => (started = resolve));
        promptThenImage(first, { onResponseStart: () => started() });
        // 1 本目が始まる前に止まった場合も待ちを解く(止めた後は残りを送らない)
        pool.after(Promise.race([firstStarted, pool.whenStopped]), () =>
          rest.forEach((partId) => promptThenImage(partId))
        );
      } else plan.prompt.forEach((partId) => promptThenImage(partId));
      const stopped = await pool.settle();
      if (stopped) throw stopped.reason;
    } finally {
      handle.pool = undefined;
    }
  }

  private waitsForPromptCache(settings: AppSettings) {
    return getTextCompletionModelProvider(settings.imagePromptTextModel) === 'anthropic';
  }

  private async renderVideo(id: string, settings: AppSettings, handle: RunHandle) {
    let project = await this.checkpoint(id, '動画', (latest) => {
      // 動画工程の保存はリビジョンの完全一致を求めない(プレビュー時のメトリクス更新などと競合させない)。
      // 書き出す内容が変わったかどうかは video:render が確かめる。
      latest.outputSettings = {
        videoPartLeadInSec: settings.videoPartLeadInSec,
        openingVideoPath: settings.openingVideoPath,
        endingVideoPath: settings.endingVideoPath,
        resolution: resolutionForAspect(
          settings.videoResolution,
          latest.presentationProfile.aspectRatio
        ),
        fps: settings.videoFps,
        videoBitrate: settings.videoBitrate,
        audioBitrate: settings.audioBitrate,
        includeOpening: Boolean(settings.openingVideoPath),
        includeEnding: Boolean(settings.endingVideoPath),
      };
      latest.job!.progress = {
        ...latest.job!.progress,
        video: { percent: 0, message: '書き出しの準備中' },
      };
    });
    if (!isVideoCurrent(project)) {
      const expected = videoInput(project);
      const saver = new ProgressSaver(
        (video) =>
          this.commit(id, (latest) => {
            if (!latest.job) return;
            latest.job.progress = { ...latest.job.progress, video };
          }),
        this.options.videoProgressIntervalMs ?? 1000
      );
      let output: { outputPath: string };
      try {
        output = await jobOperationContext.run(
          {
            signal: handle.abort.signal,
            onRenderProgress: (progress) => saver.update(progress),
          },
          () =>
            this.invoke<{ outputPath: string }>(
              'video:render',
              project,
              project.outputSettings,
              path.join(project.path, 'output', `${project.name.replace(/[\\/:*?"<>|]/g, '_')}.mp4`)
            )
        );
      } finally {
        await saver.close();
      }
      project = await this.commit(id, (latest) => {
        latest.job!.outputs.push({
          step: 'video',
          payload: output,
          createdAt: new Date().toISOString(),
        });
        latest.job!.progress = {
          ...latest.job!.progress,
          video: { percent: 100, message: '書き出し完了' },
        };
        // video:render は順番が来た時点の最新を書き出し、その入力の指紋を記録している。
        // 待つ間に書き出し内容に関係しない更新があった場合も、その記録を古い指紋で上書きしない。
        if (videoInput(latest) === expected)
          latest.integrity = { ...latest.integrity!, video: expected };
        latest.autoGenerationStatus = {
          ...latest.autoGenerationStatus,
          running: false,
          lastVideoPath: output.outputPath,
          finishedAt: new Date().toISOString(),
        };
      });
    }
    if (!isVideoCurrent(project))
      throw new Error(
        '生成中に入力が変更されました。動画は保全されていますが再書き出しが必要です。'
      );
  }

  private async run(id: string, settings: AppSettings, handle: RunHandle) {
    try {
      let needsScript = false;
      await this.checkpoint(id, '台本', (latest) => {
        needsScript =
          (Boolean(latest.job!.settings.restartScript) &&
            !latest.job!.completed.includes('script')) ||
          !latest.parts.length ||
          latest.parts.some((part) => partFreshness(latest, part).script !== 'current');
        latest.job!.progress = {
          ...latest.job!.progress,
          script: { done: needsScript ? 0 : 1, total: 1 },
        };
      });
      if (needsScript) await this.generateScript(id);
      await this.review(id, '台本の確認');
      await this.materials(id, settings, handle);
      await this.review(id, '素材と公開内容の確認');
      await this.renderVideo(id, settings, handle);
      await this.checkpoint(id, '完了');
      // 完了の記録もリビジョンの一致を求めない(動画の完成後に別の保存があっても失敗扱いにしない)
      await this.commit(id, (latest) => {
        latest.job!.status = 'completed';
        latest.job!.estimatedRemainingUsd = 0;
        latest.job!.progress = {
          ...latest.job!.progress,
          video: { percent: 100, message: '書き出し完了' },
        };
        latest.autoGenerationStatus = {
          ...latest.autoGenerationStatus,
          running: false,
          step: '完了',
          finishedAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      if (error instanceof JobPaused) return;
      if (error instanceof BudgetExceeded) {
        // 実行中だった処理はそれぞれ保存済み。並列の保存と競合しないよう、最新に対して更新する
        await this.commit(id, (latest) => {
          if (!latest.job) return;
          settleLeftoverOperations(latest.job);
          latest.job.status = 'paused';
          latest.job.stage = '予算確認';
          latest.job.estimatedRemainingUsd = error.allowance;
          latest.autoGenerationStatus = {
            ...latest.autoGenerationStatus,
            running: false,
            step: '予算確認',
          };
        }).catch(() => {});
        return;
      }
      await this.commit(id, (latest) => {
        const job = latest.job;
        if (!job) return;
        job.error = classifyGenerationError(error);
        settleLeftoverOperations(job);
        job.status = job.error.kind === 'cancelled' ? 'cancelled' : 'failed';
        latest.autoGenerationStatus = {
          ...latest.autoGenerationStatus,
          running: false,
          step: job.status === 'cancelled' ? '停止しました' : '処理に失敗しました',
          error: job.error.message,
        };
      }).catch(() => {});
    }
  }
}
