import type { GenerationJob, JobProgress } from '../../../shared/project/jobs';

/**
 * 自動生成ジョブの状態を、画面上部の進捗表示で使う形に変換する(表示専用。値は書き換えない)。
 * 工程ごとの進み具合(job.progress)は M2 のジョブエンジンが書き込む。古いジョブや、まだ書き込まれて
 * いない間は job.stage の文字で代替する。
 */

export type JobPhase =
  | 'running'
  | 'stopping'
  | 'review'
  | 'budget'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'completed';

export type JobStepKey = 'script' | 'image' | 'audio' | 'video';

export type JobStepView = {
  key: JobStepKey;
  label: string;
  state: 'waiting' | 'active' | 'done';
  /** 「3/5」「45%」など。まだ分からないときは空文字 */
  text: string;
};

export type JobView = {
  phase: JobPhase;
  /** 一番大きく出す文。例:「画像と音声を作っています」 */
  headline: string;
  /** 補足の文。なければ空文字 */
  detail: string;
  /** 全体の進み具合(0〜100)。分からないときは null(動きのあるバーで代替する) */
  percent: number | null;
  /** 工程ごとの進み具合。job.progress がないときは null */
  steps: JobStepView[] | null;
  /** 確認待ちのときに開く画面 */
  reviewTarget?: 'script' | 'image';
};

const STEP_LABELS: Record<JobStepKey, string> = {
  script: '台本',
  image: '画像',
  audio: '音声',
  video: '動画',
};

// 全体の進み具合の重み(実測の所要時間の比をもとにした目安)
const STEP_WEIGHTS: Record<JobStepKey, number> = {
  script: 0.1,
  image: 0.45,
  audio: 0.1,
  video: 0.35,
};

const RUNNING_STAGE_TEXT: Record<string, string> = {
  準備: '準備しています',
  台本: '台本を作っています',
  画像: '画像を作っています',
  音声: '音声を作っています',
  動画: '動画に仕上げています',
  完了: '仕上げています',
};

export const REVIEW_STAGE_SCRIPT = '台本の確認';
export const REVIEW_STAGE_ASSETS = '素材と公開内容の確認';
export const BUDGET_STAGE = '予算確認';

/** 実行中のジョブの段階名を、画面に出す文にする。未知の段階名はそのまま添える */
export function describeRunningStage(stage: string): string {
  const known = RUNNING_STAGE_TEXT[stage.trim()];
  if (known) return known;
  return stage.trim() ? `生成しています(${stage.trim()})` : '生成しています';
}

type StepFraction = { fraction: number; started: boolean; view: JobStepView };

function ratio(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, done / total));
}

function stepState(fraction: number, started: boolean): JobStepView['state'] {
  if (fraction >= 1) return 'done';
  return started ? 'active' : 'waiting';
}

function stageMentions(stage: string, key: JobStepKey): boolean {
  return stage.includes(STEP_LABELS[key]);
}

function buildSteps(progress: JobProgress, stage: string, completed: boolean): StepFraction[] {
  const video = progress.video;
  const videoStarted = Boolean(video && video.percent > 0) || stageMentions(stage, 'video');

  // 台本
  const script = progress.script;
  const laterStarted =
    Boolean(progress.prompt && progress.prompt.done > 0) ||
    Boolean(progress.image && progress.image.done > 0) ||
    Boolean(progress.audio && progress.audio.done > 0) ||
    videoStarted;
  const scriptFraction = completed
    ? 1
    : script && script.total > 0
      ? ratio(script.done, script.total)
      : laterStarted
        ? 1
        : 0;
  const scriptStarted = scriptFraction > 0 || stageMentions(stage, 'script');
  const scriptDone = scriptFraction >= 1;

  // 画像(画像の指示づくり + 画像づくり)。台本ができても作るものがない(total が 0)なら済みとみなす
  const partFraction = (item: { done: number; total: number } | undefined): number | null => {
    if (!item) return null;
    if (item.total > 0) return ratio(item.done, item.total);
    return scriptDone ? 1 : 0;
  };
  const promptFraction = partFraction(progress.prompt);
  const imageOnlyFraction = partFraction(progress.image);
  let imageFraction: number;
  if (completed) imageFraction = 1;
  else if (promptFraction !== null && imageOnlyFraction !== null)
    imageFraction = promptFraction / 3 + (imageOnlyFraction * 2) / 3;
  else if (imageOnlyFraction !== null) imageFraction = imageOnlyFraction;
  else if (promptFraction !== null) imageFraction = promptFraction / 3;
  else imageFraction = videoStarted ? 1 : 0;
  const imageStarted =
    imageFraction > 0 ||
    Boolean(progress.prompt && progress.prompt.done > 0) ||
    stageMentions(stage, 'image');
  const imageText =
    progress.image && progress.image.total > 0
      ? `${Math.min(progress.image.done, progress.image.total)}/${progress.image.total}`
      : '';

  // 音声
  const audioOnly = partFraction(progress.audio);
  const audioFraction = completed ? 1 : (audioOnly ?? (videoStarted ? 1 : 0));
  const audioStarted = audioFraction > 0 || stageMentions(stage, 'audio');
  const audioText =
    progress.audio && progress.audio.total > 0
      ? `${Math.min(progress.audio.done, progress.audio.total)}/${progress.audio.total}`
      : '';

  // 動画
  const videoFraction = completed ? 1 : video ? Math.min(1, Math.max(0, video.percent / 100)) : 0;
  const videoText = video ? `${Math.round(Math.min(100, Math.max(0, video.percent)))}%` : '';

  const make = (
    key: JobStepKey,
    fraction: number,
    started: boolean,
    text: string
  ): StepFraction => ({
    fraction,
    started,
    view: {
      key,
      label: STEP_LABELS[key],
      state: stepState(fraction, started),
      text: fraction >= 1 ? '' : text,
    },
  });
  return [
    make('script', scriptFraction, scriptStarted, ''),
    make('image', imageFraction, imageStarted, imageText),
    make('audio', audioFraction, audioStarted, audioText),
    make('video', videoFraction, videoStarted, videoText),
  ];
}

function hasProgress(progress: JobProgress | undefined): progress is JobProgress {
  return Boolean(
    progress &&
    (progress.script || progress.prompt || progress.image || progress.audio || progress.video)
  );
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join('、')}と${labels[labels.length - 1]}`;
}

function describeActiveSteps(steps: JobStepView[], stage: string): string {
  const active = steps.filter((step) => step.state === 'active');
  if (active.some((step) => step.key === 'video')) return '動画に仕上げています';
  if (active.length === 0) return describeRunningStage(stage);
  return `${joinLabels(active.map((step) => step.label))}を作っています`;
}

export function describeJob(job: GenerationJob): JobView {
  const stage = job.stage ?? '';
  const progressAvailable = hasProgress(job.progress);
  const completed = job.status === 'completed';
  const built = progressAvailable ? buildSteps(job.progress!, stage, completed) : null;
  const steps = built ? built.map((item) => item.view) : null;
  const percent = built
    ? Math.round(
        built.reduce((sum, item) => sum + item.fraction * STEP_WEIGHTS[item.view.key], 0) * 100
      )
    : completed
      ? 100
      : null;

  switch (job.status) {
    case 'queued':
    case 'running': {
      if (job.cancelRequested)
        return {
          phase: 'stopping',
          headline: '停止しています…',
          detail: '実行中の処理が終わりしだい止まります。できたものは保存されます。',
          percent,
          steps,
        };
      return {
        phase: 'running',
        headline:
          job.status === 'queued'
            ? '開始を待っています'
            : steps
              ? describeActiveSteps(steps, stage)
              : describeRunningStage(stage),
        detail: '',
        percent,
        steps,
      };
    }
    case 'paused': {
      if (stage === BUDGET_STAGE)
        return {
          phase: 'budget',
          headline: '予算の上限に近づいたため、自動生成を止めました',
          detail:
            '上限を外して続けるか、記事画面の「詳細設定」で予算を増やしてから「続きから」を押してください。',
          percent,
          steps,
        };
      const isScriptReview = stage === REVIEW_STAGE_SCRIPT;
      return {
        phase: 'review',
        headline: isScriptReview
          ? '台本ができました。内容を確認してください'
          : '画像と音声ができました。内容を確認してください',
        detail: '確認が終わったら「確認して続ける」を押してください。動画まで自動で進めます。',
        percent,
        steps,
        reviewTarget: isScriptReview ? 'script' : 'image',
      };
    }
    case 'failed':
      return {
        phase: 'failed',
        headline: '自動生成が途中で止まりました',
        detail: '',
        percent,
        steps,
      };
    case 'cancelled':
      return {
        phase: 'cancelled',
        headline: '自動生成を停止しました',
        detail: 'できたものは保存されています。「続きから」で再開できます。',
        percent,
        steps,
      };
    case 'interrupted':
      return {
        phase: 'interrupted',
        headline: 'アプリが終了したため、自動生成が途中で止まっています',
        detail: 'できたものは保存されています。「続きから」で再開できます。',
        percent,
        steps,
      };
    case 'completed':
    default:
      return {
        phase: 'completed',
        headline: '動画ができました',
        detail: '',
        percent: 100,
        steps,
      };
  }
}

/** 実行中(開始待ちを含む)か */
export function isJobActive(job: GenerationJob | undefined | null): boolean {
  return job?.status === 'running' || job?.status === 'queued';
}

/** 途中で止まっていて「続きから」で再開できるか */
export function isJobResumable(job: GenerationJob | undefined | null): boolean {
  return (
    job?.status === 'paused' ||
    job?.status === 'failed' ||
    job?.status === 'cancelled' ||
    job?.status === 'interrupted'
  );
}

/** 閉じた表示を覚えておくための鍵。状態や段階が変わったら再び表示する */
export function jobDismissKey(job: GenerationJob): string {
  return `${job.id}:${job.status}:${job.status === 'paused' ? job.stage : ''}`;
}

/** 金額を初心者向けに短く表す(1 セント未満は「$0.01 未満」) */
export function formatUsdShort(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0';
  if (amount < 0.01) return '$0.01 未満';
  return `$${amount.toFixed(2)}`;
}
