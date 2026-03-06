import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { Project } from '../../schemas';
import pkg from '../../../package.json';
import { nextActionLabel, stageLabel, summarizeProjectProgress } from '../../utils/projectHealth';
import { Badge, ProgressBar, StatusChip } from '../ui';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    path: '/projects',
    label: 'プロジェクト',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
    ),
  },
  {
    path: '/settings',
    label: '設定',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match?.[1] ?? null;
}

export function Sidebar() {
  const location = useLocation();
  const projectId = useMemo(() => extractProjectId(location.pathname), [location.pathname]);
  const [projectName, setProjectName] = useState<string>('');
  const [projectSummary, setProjectSummary] = useState<ReturnType<
    typeof summarizeProjectProgress
  > | null>(null);

  const returnTo = useMemo(() => {
    const state = location.state as { returnTo?: string } | null;
    if (!state || typeof state.returnTo !== 'string') return null;
    if (!state.returnTo || state.returnTo === '/settings') return null;
    return state.returnTo;
  }, [location.state]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const project: Project = await window.electronAPI.project.load(projectId);
        if (cancelled) return;
        setProjectSummary(summarizeProjectProgress(project));
        setProjectName(project.name);
      } catch {
        if (cancelled) return;
        setProjectSummary(null);
        setProjectName('');
      }
    };

    void load();
    const interval = setInterval(() => {
      void load();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  const shouldShowReturnToWork = location.pathname === '/settings' && Boolean(returnTo);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-[#0f2a4d] bg-[var(--nv-color-brand)] text-white">
      <div className="titlebar-drag border-b border-white/10 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-blue-200">NewsVideo</p>
        <h1 className="mt-1 text-xl font-bold">Desk</h1>
      </div>

      <nav className="flex-1 px-3 py-3">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={
                  item.path === '/projects' && shouldShowReturnToWork && returnTo
                    ? returnTo
                    : item.path
                }
                state={
                  item.path === '/settings'
                    ? { returnTo: `${location.pathname}${location.search}` }
                    : undefined
                }
                className={({ isActive }) =>
                  `titlebar-no-drag flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm transition-colors duration-[var(--nv-duration-fast)] ${
                    isActive
                      ? 'bg-white/18 text-white'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                {item.path === '/projects' && shouldShowReturnToWork ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 19l-7-7 7-7M3 12h18"
                    />
                  </svg>
                ) : (
                  item.icon
                )}
                <span>
                  {item.path === '/projects' && shouldShowReturnToWork ? '作業に戻る' : item.label}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>

        {projectId && projectSummary && (
          <div className="mt-5 rounded-[12px] border border-white/15 bg-white/10 p-3 text-blue-50">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold">{projectName}</p>
              <Badge tone={projectSummary.hasVideoOutput ? 'success' : 'info'}>
                {projectSummary.completedSteps}/5
              </Badge>
            </div>
            <ProgressBar
              value={projectSummary.completedSteps}
              max={projectSummary.totalSteps}
              tone={projectSummary.hasVideoOutput ? 'success' : 'accent'}
            />
            <div className="mt-3 space-y-2 text-xs text-blue-100">
              <StatusChip
                tone={projectSummary.hasVideoOutput ? 'success' : 'info'}
                label={projectSummary.hasVideoOutput ? '完成' : `次: ${stageLabel(projectSummary.stage)}`}
                className="border-white/20 bg-white/10 text-blue-50"
              />
              <p>推奨アクション: {nextActionLabel(projectSummary)}</p>
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-xs text-blue-200">v{pkg.version}</p>
      </div>
    </aside>
  );
}
