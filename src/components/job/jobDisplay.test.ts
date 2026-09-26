import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../shared/project/jobs';
import type { UsageRecord } from '../../../shared/project/schema';
import {
  describeCompletedCost,
  describeJob,
  describeRunningCost,
  describeRunningStage,
  isJobActive,
  isJobResumable,
  jobCostBreakdown,
  jobDismissKey,
} from './jobDisplay';

function job(patch: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'running',
    stage: '画像',
    mode: 'automatic',
    targetPartCount: 3,
    startedAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
    completed: [],
    outputs: [],
    reviewedStages: [],
    cancelRequested: false,
    settings: {},
    spentUsd: 0,
    estimatedRemainingUsd: 0,
    unknownCharges: 0,
    ...patch,
  };
}

describe('describeJob without progress (M2 まで)', () => {
  it('falls back to the stage text and an indeterminate bar', () => {
    const view = describeJob(job({ stage: '音声' }));
    expect(view.phase).toBe('running');
    expect(view.headline).toBe('音声を作っています');
    expect(view.percent).toBeNull();
    expect(view.steps).toBeNull();
  });

  it('describes the parallel image and audio stage of the job engine', () => {
    expect(describeRunningStage('画像と音声')).toBe('画像と音声を作っています');
    expect(describeJob(job({ stage: '画像と音声' })).headline).toBe('画像と音声を作っています');
  });

  it('keeps unknown stage names visible instead of hiding them', () => {
    expect(describeRunningStage('素材の整理')).toBe('生成しています(素材の整理)');
    expect(describeRunningStage('')).toBe('生成しています');
  });

  it('shows stopping while a cancel request is pending', () => {
    expect(describeJob(job({ cancelRequested: true })).phase).toBe('stopping');
  });
});

describe('describeJob with progress', () => {
  it('shows image and audio as started as soon as the parallel stage begins', () => {
    const view = describeJob(
      job({ stage: '画像と音声', progress: { script: { done: 1, total: 1 } } })
    );
    expect(view.headline).toBe('画像と音声を作っています');
    expect(view.steps?.map((step) => [step.key, step.state])).toEqual([
      ['script', 'done'],
      ['image', 'active'],
      ['audio', 'active'],
      ['video', 'waiting'],
    ]);
  });

  it('reports parallel image and audio work and a weighted overall percent', () => {
    const view = describeJob(
      job({
        stage: '画像',
        progress: {
          script: { done: 1, total: 1 },
          prompt: { done: 3, total: 3 },
          image: { done: 1, total: 3 },
          audio: { done: 2, total: 3 },
        },
      })
    );
    expect(view.headline).toBe('画像と音声を作っています');
    expect(view.steps?.map((step) => [step.key, step.state, step.text])).toEqual([
      ['script', 'done', ''],
      ['image', 'active', '1/3'],
      ['audio', 'active', '2/3'],
      ['video', 'waiting', ''],
    ]);
    // 台本 0.1 + 画像 0.45 × (1/3 + 2/9) + 音声 0.1 × 2/3 ≈ 0.4167
    expect(view.percent).toBe(42);
  });

  it('shows the video percent while finishing', () => {
    const view = describeJob(
      job({
        stage: '動画',
        progress: {
          script: { done: 1, total: 1 },
          image: { done: 3, total: 3 },
          audio: { done: 3, total: 3 },
          video: { percent: 40 },
        },
      })
    );
    expect(view.headline).toBe('動画に仕上げています');
    expect(view.steps?.find((step) => step.key === 'video')).toMatchObject({
      state: 'active',
      text: '40%',
    });
    expect(view.percent).toBe(79);
  });

  it('treats steps with nothing to make as done once the script is ready', () => {
    const view = describeJob(
      job({
        stage: '音声',
        progress: {
          script: { done: 1, total: 1 },
          prompt: { done: 0, total: 0 },
          image: { done: 0, total: 0 },
          audio: { done: 1, total: 2 },
        },
      })
    );
    expect(view.steps?.find((step) => step.key === 'image')?.state).toBe('done');
    expect(view.headline).toBe('音声を作っています');
  });
});

describe('describeJob stopped states', () => {
  it('explains the budget pause and how to get out of it', () => {
    const view = describeJob(job({ status: 'paused', stage: '予算確認' }));
    expect(view.phase).toBe('budget');
    expect(view.detail).toContain('上限を外して続ける');
  });

  it('points the review pause at the right screen', () => {
    expect(describeJob(job({ status: 'paused', stage: '台本の確認' })).reviewTarget).toBe('script');
    expect(describeJob(job({ status: 'paused', stage: '素材と公開内容の確認' })).reviewTarget).toBe(
      'image'
    );
  });

  it('maps the remaining statuses', () => {
    expect(describeJob(job({ status: 'failed' })).phase).toBe('failed');
    expect(describeJob(job({ status: 'cancelled' })).phase).toBe('cancelled');
    expect(describeJob(job({ status: 'interrupted' })).phase).toBe('interrupted');
    const completed = describeJob(job({ status: 'completed', stage: '完了' }));
    expect(completed).toMatchObject({ phase: 'completed', percent: 100 });
  });
});

describe('helpers', () => {
  it('classifies active and resumable jobs', () => {
    expect(isJobActive(job({ status: 'queued' }))).toBe(true);
    expect(isJobActive(job({ status: 'paused' }))).toBe(false);
    expect(isJobResumable(job({ status: 'paused' }))).toBe(true);
    expect(isJobResumable(job({ status: 'completed' }))).toBe(false);
    expect(isJobResumable(undefined)).toBe(false);
  });

  it('changes the dismiss key when the status or pause stage changes', () => {
    const paused = jobDismissKey(job({ status: 'paused', stage: '台本の確認' }));
    expect(paused).not.toBe(jobDismissKey(job({ status: 'paused', stage: '予算確認' })));
    expect(jobDismissKey(job({ status: 'failed' }))).not.toBe(
      jobDismissKey(job({ status: 'completed' }))
    );
  });
});

// M5: 生成中の「今回の費用」と、完了時の内訳
describe('job cost text', () => {
  it('shows the spent amount and the expected total while running, in yen and dollars', () => {
    expect(describeRunningCost(job({ spentUsd: 0.12, estimatedTotalUsd: 0.5 }), 150)).toBe(
      '今回 約 18 円($0.12)・見込み 約 75 円($0.50)'
    );
    // 見込みより多く使ったときは、使った額を見込みにする
    expect(describeRunningCost(job({ spentUsd: 0.6, estimatedTotalUsd: 0.5 }), 150)).toBe(
      '今回 約 90 円($0.60)・見込み 約 90 円($0.60)'
    );
    // 見込みを記録していない以前のジョブは、使った額だけ
    expect(describeRunningCost(job({ spentUsd: 0 }), 150)).toBe('今回 0 円($0.00)');
  });

  it('breaks the completed cost down into script, images (including image prompts) and audio', () => {
    const jobId = '00000000-0000-4000-8000-000000000001';
    const record = (patch: Partial<UsageRecord>): UsageRecord => ({
      id: crypto.randomUUID(),
      provider: 'anthropic',
      category: 'text',
      model: 'claude-opus-5-5',
      operation: 'script_generate',
      jobId,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: '2026-09-26T00:00:00.000Z',
      ...patch,
    });
    const usage = [
      record({ outputTokens: 1_000 }), // 台本 $0.02
      record({ operation: 'image_prompt_generate', outputTokens: 1_000 }), // 画像の指示 $0.02
      record({
        provider: 'openai',
        category: 'image',
        model: 'gpt-image-2.5-sunburst',
        operation: 'image_generate',
        textInputTokens: 0,
        outputTokens: 10_000,
      }), // 画像 $0.30
      record({
        provider: 'gemini',
        category: 'tts',
        model: 'gemini-3.8-flash-tts',
        operation: 'tts_generate',
        outputTokens: 10_000,
      }), // 音声 $0.09
      record({ jobId: '00000000-0000-4000-8000-000000000099', outputTokens: 50_000 }), // 別のジョブ
    ];
    const breakdown = jobCostBreakdown(usage, job())!;
    expect(breakdown.script).toBeCloseTo(0.02, 10);
    expect(breakdown.image).toBeCloseTo(0.32, 10);
    expect(breakdown.audio).toBeCloseTo(0.09, 10);
    expect(jobCostBreakdown([], job())).toBeNull();

    expect(describeCompletedCost(job({ spentUsd: 0.43 }), breakdown, 150)).toBe(
      '今回かかった費用(推定): 約 65 円($0.43)。内訳は 台本 約 3 円($0.02)・画像 約 48 円($0.32)・音声 約 14 円($0.09)'
    );
    expect(describeCompletedCost(job({ spentUsd: 0.43, unknownCharges: 1 }), null, 150)).toBe(
      '今回かかった費用(推定): 約 65 円($0.43)。一部の料金は各サービスの利用明細で確認してください'
    );
  });
});
