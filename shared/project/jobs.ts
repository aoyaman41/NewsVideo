import { z } from 'zod';

const jobStepProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

// 工程ごとの進み具合。並列に進む工程(画像と音声など)を同時に表せるよう、工程ごとに持つ。
// ジョブエンジンが書き込み、画面の進捗表示が読む。古いジョブには存在しない。
export const jobProgressSchema = z.object({
  script: jobStepProgressSchema.optional(),
  prompt: jobStepProgressSchema.optional(),
  image: jobStepProgressSchema.optional(),
  audio: jobStepProgressSchema.optional(),
  video: z
    .object({
      percent: z.number().min(0).max(100),
      message: z.string().optional(),
    })
    .optional(),
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

// 実行中(料金が発生しうる)の処理。再起動時に、結果を受け取れなかった処理を「料金未確定」として数える
export const pendingOperationSchema = z.object({
  step: z.string(),
  kind: z.enum(['script', 'prompt', 'image', 'audio']),
  estimatedUsd: z.number(),
});
export type PendingOperation = z.infer<typeof pendingOperationSchema>;

export const jobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    'queued',
    'running',
    'paused',
    'cancelled',
    'failed',
    'completed',
    'interrupted',
  ]),
  stage: z.string(),
  mode: z.enum(['automatic', 'review']),
  targetPartCount: z.number().int().min(1).max(20),
  startedAt: z.string(),
  updatedAt: z.string(),
  completed: z.array(z.string()),
  /** 旧形式(1 件だけ記録していたころ)。読み込みのためだけに残す。新しいジョブは pendingOperations に書く */
  pendingOperation: pendingOperationSchema.optional(),
  /** 並列に実行中の処理。予算の判定では、これらの見込み額を予約済みとして数える */
  pendingOperations: z.array(pendingOperationSchema).optional(),
  outputs: z
    .array(z.object({ step: z.string(), payload: z.unknown(), createdAt: z.string() }))
    .default([]),
  reviewedStages: z.array(z.string()),
  cancelRequested: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  budgetUsd: z.number().nonnegative().optional(),
  spentUsd: z.number().nonnegative(),
  estimatedRemainingUsd: z.number().nonnegative(),
  unknownCharges: z.number().int().nonnegative(),
  error: z.object({ kind: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
  progress: jobProgressSchema.optional(),
});
export type GenerationJob = z.infer<typeof jobSchema>;

/** 実行中の処理の一覧(旧形式の単一の記録も含める) */
export function pendingOperationsOf(
  job: Pick<GenerationJob, 'pendingOperation' | 'pendingOperations'>
): PendingOperation[] {
  return [
    ...(job.pendingOperation ? [job.pendingOperation] : []),
    ...(job.pendingOperations ?? []),
  ];
}

export function classifyGenerationError(error: unknown) {
  const status = Number((error as { status?: number })?.status);
  const message = error instanceof Error ? error.message : String(error);
  const kind =
    status === 401 || status === 403 || /APIキー|api.?key|authenticat/i.test(message)
      ? 'authentication'
      : status === 429
        ? 'rate_limit'
        : status >= 500 || /timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message)
          ? 'transient'
          : /ENOSPC|EACCES|保存|書き込/i.test(message)
            ? 'storage'
            : /CONFLICT|競合|変更されました/.test(message)
              ? 'conflict'
              : /cancel|キャンセル/i.test(message)
                ? 'cancelled'
                : 'invalid_input';
  return {
    kind,
    message: message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1500),
    retryable: ['rate_limit', 'transient', 'storage', 'conflict'].includes(kind),
  };
}

export const JOB_STATUS_LABELS = {
  queued: '開始待ち',
  running: '生成中',
  paused: '確認待ち',
  cancelled: '停止済み',
  failed: '失敗',
  completed: '完了',
  interrupted: '再開待ち',
} as const;
