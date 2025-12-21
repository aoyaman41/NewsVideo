import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../../schemas';
import { DEFAULT_COST_RATES, formatUsd, sumUsageCostUsd, type CostRates } from '../../utils/cost';

export type WorkflowStage = 'article' | 'script' | 'image' | 'audio' | 'video';

type StepStatus = 'done' | 'todo';

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

function safeTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function computeProgress(project?: Project | null) {
  const parts = project?.parts ?? [];
  const totalParts = parts.length;

  const hasArticle =
    safeTrim(project?.article?.title).length > 0 &&
    safeTrim(project?.article?.bodyText).length > 0;

  const partsWithPrompt = project?.prompts
    ? new Set(project.prompts.map((p) => p.partId)).size
    : 0;
  const partsWithAssignedImages = parts.filter((p) => (p.panelImages?.length ?? 0) > 0).length;
  const partsWithAudio = parts.filter((p) => Boolean(p.audio)).length;

  const allAssignedImages = totalParts > 0 && partsWithAssignedImages === totalParts;
  const allAudio = totalParts > 0 && partsWithAudio === totalParts;

  return {
    totalParts,
    hasArticle,
    partsWithPrompt,
    partsWithAssignedImages,
    partsWithAudio,
    allAssignedImages,
    allAudio,
  };
}

function statusFor(step: WorkflowStage, progress: ReturnType<typeof computeProgress>): StepStatus {
  switch (step) {
    case 'article':
      return progress.hasArticle ? 'done' : 'todo';
    case 'script':
      return progress.totalParts > 0 ? 'done' : 'todo';
    case 'image':
      return progress.allAssignedImages ? 'done' : 'todo';
    case 'audio':
      return progress.allAudio ? 'done' : 'todo';
    case 'video':
      return 'todo';
    default:
      return 'todo';
  }
}

function detailFor(step: WorkflowStage, progress: ReturnType<typeof computeProgress>): string {
  const n = progress.totalParts;
  switch (step) {
    case 'article':
      return progress.hasArticle ? '入力済' : '未入力';
    case 'script':
      return n > 0 ? `${n}パート` : '未生成';
    case 'image':
      return n > 0
        ? `プロンプト ${progress.partsWithPrompt}/${n} ・ 割当 ${progress.partsWithAssignedImages}/${n}`
        : '未生成';
    case 'audio':
      return n > 0 ? `生成 ${progress.partsWithAudio}/${n}` : '未生成';
    case 'video':
      return progress.allAssignedImages && progress.allAudio ? '準備OK' : '準備中';
    default:
      return '';
  }
}

function stylesFor(status: StepStatus, isCurrent: boolean) {
  if (isCurrent) {
    return {
      circle: 'bg-blue-600 border-blue-600 text-white ring-2 ring-blue-200',
      label: 'text-gray-900 font-semibold',
      sub: 'text-blue-700',
    };
  }
  if (status === 'done') {
    return {
      circle: 'bg-green-600 border-green-600 text-white',
      label: 'text-gray-900',
      sub: 'text-green-700',
    };
  }
  return {
    circle: 'bg-white border-gray-300 text-gray-500',
    label: 'text-gray-700',
    sub: 'text-gray-500',
  };
}

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
  const progress = useMemo(() => computeProgress(project), [project]);
  const currentIndex = useMemo(() => steps.findIndex((s) => s.key === current), [current]);
  const usageRecords = project?.usage ?? [];
  const totalCost = useMemo(
    () => sumUsageCostUsd(usageRecords, costRates),
    [usageRecords, costRates]
  );
  const openaiCost = useMemo(
    () => sumUsageCostUsd(usageRecords.filter((r) => r.provider === 'openai'), costRates),
    [usageRecords, costRates]
  );
  const geminiCost = useMemo(
    () => sumUsageCostUsd(usageRecords.filter((r) => r.provider === 'gemini'), costRates),
    [usageRecords, costRates]
  );

  useEffect(() => {
    let cancelled = false;
    const loadRates = async () => {
      try {
        const settings = await window.electronAPI.settings.get();
        if (cancelled) return;
        if (settings?.cost) {
          setCostRates(settings.cost);
        }
      } catch {
        // fallback to default
      }
    };
    loadRates();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <nav aria-label="Workflow" className="titlebar-no-drag bg-white border-b border-gray-200">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">ワークフロー</span>
            <span className="ml-2">
              {currentIndex >= 0 ? `${currentIndex + 1}/${steps.length}` : `1/${steps.length}`}
            </span>
          </div>
          {project && (
            <div className="text-xs text-gray-500 truncate">
              {progress.totalParts > 0 ? `パート ${progress.totalParts}` : 'パート未生成'}
            </div>
          )}
          {project && (
            <div
              className="text-xs text-gray-600"
              title={`OpenAI ${formatUsd(openaiCost)} / Gemini ${formatUsd(geminiCost)}`}
            >
              推定コスト {formatUsd(totalCost)}
            </div>
          )}
        </div>

        <ol className="mt-3 flex items-center gap-3 overflow-x-auto pb-1">
          {steps.map((step, idx) => {
            const isCurrent = step.key === current;
            const status = statusFor(step.key, progress);
            const detail = project ? detailFor(step.key, progress) : '';
            const styles = stylesFor(status, isCurrent);

            const connectorClass =
              idx < steps.length - 1
                ? status === 'done'
                  ? 'bg-green-300'
                  : 'bg-gray-200'
                : '';

            return (
              <li key={step.key} className="flex items-center">
                <button
                  type="button"
                  onClick={() => navigate(step.to(projectId))}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="titlebar-no-drag group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  title={detail}
                >
                  <span
                    className={`flex items-center justify-center w-9 h-9 rounded-full border text-sm font-semibold transition-colors ${styles.circle}`}
                  >
                    {status === 'done' ? (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </span>

                  <div className="text-left min-w-[5.5rem]">
                    <div className="flex items-center gap-1">
                      <div className={`text-sm leading-4 ${styles.label}`}>{step.label}</div>
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-600 text-white">
                          現在
                        </span>
                      )}
                    </div>
                    {project && <div className={`text-[11px] mt-0.5 leading-4 ${styles.sub}`}>{detail}</div>}
                  </div>
                </button>

                {idx < steps.length - 1 && (
                  <div className={`h-px w-8 rounded ${connectorClass} shrink-0`} />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
