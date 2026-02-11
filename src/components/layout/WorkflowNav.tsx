import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../../schemas';
import { DEFAULT_COST_RATES, formatUsd, sumUsageCostUsd, type CostRates } from '../../utils/cost';
import { stageLabel, summarizeProjectProgress } from '../../utils/projectHealth';
import type { WorkflowStage } from '../../types/ui';
import { Badge } from '../ui';

type StepStatus = 'done' | 'todo' | 'current';

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

function stepStatus(
  stage: WorkflowStage,
  current: WorkflowStage,
  completedSteps: number
): StepStatus {
  if (stage === current) return 'current';
  const stepIndex = steps.findIndex((s) => s.key === stage);
  const currentIndex = steps.findIndex((s) => s.key === current);
  if (stepIndex < 0 || currentIndex < 0) return 'todo';
  if (stepIndex < currentIndex && completedSteps > stepIndex) return 'done';
  return 'todo';
}

function stylesFor(status: StepStatus): string {
  if (status === 'current') {
    return 'border-[var(--nv-color-accent)] bg-blue-50 text-blue-800';
  }
  if (status === 'done') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
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

  const usageRecords = displayProject?.usage ?? [];
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
        if (settings?.cost) setCostRates(settings.cost);
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
          const status = stepStatus(step.key, current, summary?.completedSteps ?? 0);
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
