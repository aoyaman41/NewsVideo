import { partFreshness } from '../../../shared/project/integrity';
import { projectClient, useProjectState } from '../../stores/projectStore';
import { Fragment, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../../schemas';
import { summarizeProjectProgress } from '../../utils/projectHealth';
import type { WorkflowStage } from '../../types/ui';
import { cx } from '../../utils/cx';
import { WORKFLOW_STAGE_LABELS, WORKFLOW_STAGES, nextStepHint } from './workflowLabels';

type NonCurrentStepStatus = 'done' | 'warning' | 'todo';
type StepStatus = NonCurrentStepStatus | 'current';

function hasText(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function computeStepStatuses(
  project: Project | null | undefined,
  summary: ReturnType<typeof summarizeProjectProgress> | null
): Record<WorkflowStage, NonCurrentStepStatus> {
  if (!project || !summary) {
    return {
      article: 'todo',
      script: 'todo',
      image: 'todo',
      audio: 'todo',
      video: 'todo',
    };
  }

  const hasArticle = hasText(project.article?.title) && hasText(project.article?.bodyText);
  const hasScript =
    summary.partCount > 0 &&
    project.parts.every((part) => partFreshness(project, part).script === 'current');
  const hasImage = hasScript && summary.missingPrompts === 0 && summary.missingImages === 0;
  const hasAudio = hasScript && summary.missingAudio === 0;
  const hasVideo = summary.hasVideoOutput;

  const imageInProgress =
    hasScript &&
    !hasImage &&
    (summary.missingPrompts < summary.partCount || summary.missingImages < summary.partCount);
  const audioInProgress = hasScript && !hasAudio && summary.missingAudio < summary.partCount;
  const videoInProgress = !hasVideo && (hasImage || hasAudio || imageInProgress || audioInProgress);

  return {
    article: hasArticle ? 'done' : 'todo',
    script: hasScript ? 'done' : 'todo',
    image: hasImage ? 'done' : imageInProgress ? 'warning' : 'todo',
    audio: hasAudio ? 'done' : audioInProgress ? 'warning' : 'todo',
    video: hasVideo ? 'done' : videoInProgress ? 'warning' : 'todo',
  };
}

const STATUS_TEXT: Record<StepStatus, string> = {
  current: '表示中',
  done: 'できています',
  warning: '途中です',
  todo: 'まだです',
};

function badgeClass(status: StepStatus): string {
  switch (status) {
    case 'current':
      return 'border-[var(--nv-color-accent)] bg-[var(--nv-color-accent)] text-white';
    case 'done':
      return 'border-[var(--nv-color-success)] bg-[var(--nv-color-surface)] text-[var(--nv-color-success)]';
    case 'warning':
      return 'border-[var(--nv-color-warning)] bg-[var(--nv-color-surface)] text-[var(--nv-color-warning)]';
    case 'todo':
    default:
      return 'border-[var(--nv-color-border)] bg-[var(--nv-color-surface)] text-[var(--nv-color-muted)]';
  }
}

export { type WorkflowStage };

/**
 * 工程ナビ(1 行)。記事 → 台本 → 画像 → 音声 → 動画 のどこにいるかと、各工程の状態を示す。
 * 費用は常時は出さない(記事画面の見積もりと、自動生成の完成時の合計だけにする)。
 */
export function WorkflowNav({
  projectId,
  current,
  project,
}: {
  projectId: string;
  current: WorkflowStage;
  project?: Project | null;
}) {
  const navigate = useNavigate();
  const [liveProject] = useProjectState(projectId);
  const displayProject = liveProject ?? project;
  const summary = useMemo(
    () => (displayProject ? summarizeProjectProgress(displayProject) : null),
    [displayProject]
  );
  const stepStatuses = useMemo(
    () => computeStepStatuses(displayProject, summary),
    [displayProject, summary]
  );

  useEffect(() => {
    if (projectId) void projectClient.load(projectId).catch(() => {});
  }, [projectId]);

  return (
    <nav
      aria-label="制作の工程"
      className="titlebar-no-drag flex shrink-0 items-center justify-between gap-3 border-b border-[var(--nv-color-border)] bg-[var(--nv-color-surface)] px-5 py-1.5"
    >
      <ol className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {WORKFLOW_STAGES.map((stage, index) => {
          const status: StepStatus = stage === current ? 'current' : stepStatuses[stage];
          return (
            <Fragment key={stage}>
              {index > 0 && (
                <li aria-hidden="true" className="px-0.5 text-xs text-[var(--nv-color-muted)]">
                  ›
                </li>
              )}
              <li>
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${projectId}/${stage}`)}
                  aria-current={stage === current ? 'step' : undefined}
                  aria-label={`${index + 1}. ${WORKFLOW_STAGE_LABELS[stage]}(${STATUS_TEXT[status]})`}
                  className={cx(
                    'nv-focus-ring flex items-center gap-1.5 rounded-[var(--nv-radius-sm)] px-2 py-1 text-sm transition-colors duration-[var(--nv-duration-fast)] hover:bg-[var(--nv-color-canvas)]',
                    stage === current
                      ? 'font-semibold text-[var(--nv-color-text)]'
                      : 'text-[var(--nv-color-muted)]'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold',
                      badgeClass(status)
                    )}
                  >
                    {status === 'done' ? '✓' : index + 1}
                  </span>
                  {WORKFLOW_STAGE_LABELS[stage]}
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
      {summary && (
        <p className="hidden shrink-0 text-xs text-[var(--nv-color-muted)] lg:block">
          {nextStepHint(summary)}
        </p>
      )}
    </nav>
  );
}
