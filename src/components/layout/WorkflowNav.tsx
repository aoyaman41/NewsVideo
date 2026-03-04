import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../../schemas';
import {
  DEFAULT_COST_RATES,
  formatUsd,
  normalizeCostRates,
  sumUsageCostUsd,
  type CostRates,
} from '../../utils/cost';
import { stageLabel, summarizeProjectProgress } from '../../utils/projectHealth';
import type { WorkflowStage } from '../../types/ui';
import { Badge } from '../ui';

type NonCurrentStepStatus = 'done' | 'warning' | 'todo';
type StepStatus = NonCurrentStepStatus | 'current';

type Step = {
  key: WorkflowStage;
  label: string;
  to: (projectId: string) => string;
};

const steps: Step[] = [
  { key: 'article', label: '記事', to: (id) => `/projects/${id}/article` },
  { key: 'script', label: 'スクリプト', to: (id) => `/projects/${id}/script` },
  { key: 'image', label: '画像', to: (id) => `/projects/${id}/image` },
  { key: 'audio', label: '音声', to: (id) => `/projects/${id}/audio` },
  { key: 'video', label: '動画', to: (id) => `/projects/${id}/video` },
];

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
  const hasScript = summary.partCount > 0;
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

function stylesFor(status: StepStatus): string {
  if (status === 'current') {
    return 'border-[var(--nv-color-accent)] bg-blue-50 text-blue-800';
  }
  if (status === 'done') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-[var(--nv-color-border)] bg-white text-slate-600 hover:bg-slate-50';
}

export { type WorkflowStage };

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
  const [costRates, setCostRates] = useState<CostRates>(DEFAULT_COST_RATES);
  const [liveProject, setLiveProject] = useState<Project | null | undefined>(project);
  const displayProject = liveProject ?? project;
  const summary = useMemo(
    () => (displayProject ? summarizeProjectProgress(displayProject) : null),
    [displayProject]
  );
  const stepStatuses = useMemo(
    () => computeStepStatuses(displayProject, summary),
    [displayProject, summary]
  );

  const usageRecords = useMemo(() => displayProject?.usage ?? [], [displayProject?.usage]);
  const totalCost = useMemo(
    () => sumUsageCostUsd(usageRecords, costRates),
    [usageRecords, costRates]
  );

  useEffect(() => {
    setLiveProject(project);
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const loadRates = async () => {
      try {
        const settings = await window.electronAPI.settings.get();
        if (cancelled) return;
        setCostRates(normalizeCostRates(settings?.cost));
      } catch {
        // noop
      }
    };
    void loadRates();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const latest = await window.electronAPI.project.load(projectId);
        if (cancelled) return;
        setLiveProject(latest);
      } catch {
        // noop
      }
    };

    void tick();
    const interval = setInterval(tick, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  return (
    <nav
      aria-label="Workflow"
      className="titlebar-no-drag border-b border-[var(--nv-color-border)] bg-white px-5 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">ワークフロー</span>
          {summary && (
            <Badge tone={summary.hasVideoOutput ? 'success' : 'info'}>
              {summary.completedSteps}/{summary.totalSteps}
            </Badge>
          )}
          {summary && <span>次: {stageLabel(summary.stage)}</span>}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          {summary && <span>パート {summary.partCount}</span>}
          {summary && (
            <span>
              未プロンプト {summary.missingPrompts} / 未画像 {summary.missingImages} / 未音声{' '}
              {summary.missingAudio}
            </span>
          )}
          {displayProject && <span>推定コスト {formatUsd(totalCost)}</span>}
        </div>
      </div>

      <ol className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
        {steps.map((step) => {
          const status: StepStatus = step.key === current ? 'current' : stepStatuses[step.key];
          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => navigate(step.to(projectId))}
                className={`titlebar-no-drag rounded-[8px] border px-3 py-1.5 text-xs font-semibold transition-colors duration-[var(--nv-duration-fast)] ${stylesFor(
                  status
                )}`}
                aria-current={step.key === current ? 'step' : undefined}
              >
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
