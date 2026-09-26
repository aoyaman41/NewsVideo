import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GenerationJob } from '../../../shared/project/jobs';
import type { Tone } from '../../types/ui';
import { cx } from '../../utils/cx';
import { dismissJob, useJobFeed } from '../../stores/jobStore';
import { projectClient, useProjectState } from '../../stores/projectStore';
import { FriendlyError } from '../errors/FriendlyError';
import { errorToastContent, explainError } from '../errors/explainError';
import { projectIdFromPath } from '../layout/workflowLabels';
import { Button, StatusChip, useToast } from '../ui';
import { cancelJob, resumeJob } from './jobActions';
import {
  describeJob,
  formatUsdShort,
  isJobActive,
  jobDismissKey,
  type JobPhase,
  type JobStepView,
} from './jobDisplay';

const PHASE_CHIP: Record<JobPhase, { tone: Tone; label: string }> = {
  running: { tone: 'info', label: '生成中' },
  stopping: { tone: 'info', label: '停止中' },
  review: { tone: 'warning', label: '確認待ち' },
  budget: { tone: 'warning', label: '一時停止' },
  failed: { tone: 'danger', label: '停止' },
  cancelled: { tone: 'neutral', label: '停止' },
  interrupted: { tone: 'neutral', label: '中断' },
  completed: { tone: 'success', label: '完成' },
};

const PHASE_BORDER: Record<Tone, string> = {
  info: 'border-l-[var(--nv-color-accent)]',
  warning: 'border-l-[var(--nv-color-warning)]',
  danger: 'border-l-[var(--nv-color-danger)]',
  neutral: 'border-l-[var(--nv-color-border)]',
  success: 'border-l-[var(--nv-color-success)]',
};

type BannerItem = { projectId: string; job: GenerationJob; isRoute: boolean };

function shouldShow(
  job: GenerationJob,
  { live, isRoute }: { live: boolean; isRoute: boolean },
  dismissed: ReadonlySet<string>
): boolean {
  if (dismissed.has(jobDismissKey(job))) return false;
  if (isJobActive(job) || job.status === 'paused') return true;
  if (job.status === 'completed') return live;
  // 失敗・停止・中断は、今動いたものか、開いているプロジェクトのものだけ
  return live || isRoute;
}

/**
 * どの画面にいても上部に出す自動生成の進捗表示。開いているプロジェクトのジョブを優先し、
 * ほかのプロジェクトで動いているジョブも出す(最大 2 件)。
 */
export function JobProgressBanner() {
  const location = useLocation();
  const routeProjectId = projectIdFromPath(location.pathname);
  const feed = useJobFeed();
  const [routeProject] = useProjectState(routeProjectId ?? undefined);

  const items = useMemo(() => {
    const result: BannerItem[] = [];
    if (routeProjectId) {
      const tracked = feed.jobs.get(routeProjectId);
      const job = tracked?.job ?? routeProject?.job;
      if (job && shouldShow(job, { live: Boolean(tracked), isRoute: true }, feed.dismissed))
        result.push({ projectId: routeProjectId, job, isRoute: true });
    }
    // 実行中・確認待ちのジョブを、完成・失敗の表示より先に出す(停止ボタンが押し出されないように)
    const others = [...feed.jobs.values()]
      .filter((tracked) => tracked.projectId !== routeProjectId)
      .sort((a, b) => {
        const rank = (job: GenerationJob) => (isJobActive(job) || job.status === 'paused' ? 0 : 1);
        return rank(a.job) - rank(b.job) || b.sequence - a.sequence;
      });
    for (const tracked of others) {
      if (shouldShow(tracked.job, { live: true, isRoute: false }, feed.dismissed))
        result.push({ projectId: tracked.projectId, job: tracked.job, isRoute: false });
    }
    return result.slice(0, 2);
  }, [feed, routeProject?.job, routeProjectId]);

  if (items.length === 0) return null;
  return (
    <div className="titlebar-no-drag shrink-0">
      {items.map((item) => (
        <JobBannerItem key={`${item.projectId}:${item.job.id}`} {...item} />
      ))}
    </div>
  );
}

function StepChips({ steps }: { steps: JobStepView[] }) {
  return (
    <ol className="hidden shrink-0 items-center gap-1.5 xl:flex" aria-label="工程ごとの進み具合">
      {steps.map((step) => (
        <li
          key={step.key}
          className={cx(
            'rounded-[var(--nv-radius-sm)] border px-2 py-0.5 text-xs font-semibold',
            step.state === 'done'
              ? 'border-[var(--nv-color-border)] text-[var(--nv-color-success)]'
              : step.state === 'active'
                ? 'border-[var(--nv-color-accent)] text-[var(--nv-color-accent)]'
                : 'border-[var(--nv-color-border)] text-[var(--nv-color-muted)]'
          )}
        >
          {step.label}
          {step.state === 'done' ? ' ✓' : step.text ? ` ${step.text}` : ''}
        </li>
      ))}
    </ol>
  );
}

function OverallBar({ percent }: { percent: number | null }) {
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--nv-color-canvas)]"
      role="progressbar"
      aria-label="自動生成の進み具合"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      {percent === null ? (
        <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--nv-color-accent)]" />
      ) : (
        <div
          className="h-full rounded-full bg-[var(--nv-color-accent)] transition-[width] duration-[var(--nv-duration-base)]"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      )}
    </div>
  );
}

function JobBannerItem({ projectId, job, isRoute }: BannerItem) {
  const navigate = useNavigate();
  const toast = useToast();
  const [project] = useProjectState(projectId);
  const [pending, setPending] = useState(false);
  const view = describeJob(job);
  const chip = PHASE_CHIP[view.phase];

  // ほかのプロジェクトのジョブは、名前を出すために読み込んでおく
  useEffect(() => {
    if (!isRoute) void projectClient.load(projectId).catch(() => {});
  }, [isRoute, projectId]);

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
    } catch (error) {
      const content = errorToastContent(explainError(error));
      toast.error(content.message, content.title);
    } finally {
      setPending(false);
    }
  };

  const dismiss = () => dismissJob(jobDismissKey(job));
  const open = (stage: 'article' | 'script' | 'image' | 'video') =>
    navigate(`/projects/${projectId}/${stage}`);
  const resume = (overrides?: { budgetUsd?: number | null }) =>
    void run(() => resumeJob(projectId, job, overrides));

  const projectName = !isRoute && project?.name ? project.name : '';
  const showBar = view.phase === 'running' || view.phase === 'stopping';

  let detail = view.detail;
  if (view.phase === 'completed') {
    detail = `今回の費用の目安: ${formatUsdShort(job.spentUsd)}${
      job.unknownCharges > 0 ? '(一部の料金は各サービスの利用明細で確認してください)' : ''
    }`;
  }

  const actions = (() => {
    switch (view.phase) {
      case 'running':
        return (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => void run(() => cancelJob(projectId))}
          >
            停止
          </Button>
        );
      case 'stopping':
        return null;
      case 'review':
        return (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => open(view.reviewTarget ?? 'script')}
            >
              内容を見る
            </Button>
            <Button size="sm" disabled={pending} onClick={() => resume()}>
              確認して続ける
            </Button>
          </>
        );
      case 'budget':
        return (
          <>
            <Button size="sm" variant="secondary" onClick={() => open('article')}>
              予算を変える
            </Button>
            <Button size="sm" disabled={pending} onClick={() => resume({ budgetUsd: null })}>
              上限を外して続ける
            </Button>
          </>
        );
      case 'failed':
        return (
          <Button size="sm" variant="ghost" onClick={dismiss}>
            閉じる
          </Button>
        );
      case 'cancelled':
      case 'interrupted':
        return (
          <>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              閉じる
            </Button>
            <Button size="sm" disabled={pending} onClick={() => resume()}>
              続きから
            </Button>
          </>
        );
      case 'completed':
      default:
        return (
          <>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              閉じる
            </Button>
            <Button
              size="sm"
              variant="success"
              onClick={() => {
                dismiss();
                open('video');
              }}
            >
              動画を見る
            </Button>
          </>
        );
    }
  })();

  return (
    <section
      aria-label="自動生成の状況"
      className={cx(
        'border-b border-l-4 border-[var(--nv-color-border)] bg-[var(--nv-color-surface)] px-5 py-2.5',
        PHASE_BORDER[chip.tone]
      )}
    >
      <div className="flex items-start gap-3">
        <StatusChip tone={chip.tone} label={chip.label} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1" role="status" aria-live="polite">
          {view.phase === 'failed' ? (
            <FriendlyError
              bare
              title={projectName ? `${view.headline}(${projectName})` : view.headline}
              error={job.error?.message ?? '原因が記録されていません'}
              kind={job.error?.kind}
              onRetry={() => resume()}
              retryLabel="続きから"
            />
          ) : (
            <>
              <p className="truncate text-sm font-semibold text-[var(--nv-color-text)]">
                {view.headline}
                {projectName && (
                  <span className="font-normal text-[var(--nv-color-muted)]"> ・{projectName}</span>
                )}
              </p>
              {detail && <p className="mt-0.5 text-xs text-[var(--nv-color-muted)]">{detail}</p>}
            </>
          )}
        </div>
        {view.steps && showBar && <StepChips steps={view.steps} />}
        <div className="flex shrink-0 items-center gap-2">
          {!isRoute && view.phase !== 'completed' && (
            <Button size="sm" variant="ghost" onClick={() => open('article')}>
              開く
            </Button>
          )}
          {actions}
        </div>
      </div>
      {showBar && <OverallBar percent={view.percent} />}
    </section>
  );
}
