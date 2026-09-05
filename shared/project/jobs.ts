import { z } from 'zod';

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
  pendingOperation: z
    .object({
      step: z.string(),
      kind: z.enum(['script', 'prompt', 'image', 'audio']),
      estimatedUsd: z.number(),
    })
    .optional(),
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
});
export type GenerationJob = z.infer<typeof jobSchema>;

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
