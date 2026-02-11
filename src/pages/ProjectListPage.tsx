import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ProgressBar,
  Skeleton,
  StatusChip,
} from '../components/ui';
import type { ProjectListItem } from '../types/ui';
import { nextActionLabel, stageLabel } from '../utils/projectHealth';

export function ProjectListPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  useEffect(() => {
    void loadProjects();
  }, []);

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      const list = await window.electronAPI.project.list();
      setProjects(list);
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setIsCreating(true);
    try {
      await window.electronAPI.project.create(newProjectName.trim());
      setNewProjectName('');
      await loadProjects();
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!deleteTargetId) return;
    try {
      await window.electronAPI.project.delete(deleteTargetId);
      setDeleteTargetId(null);
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setOpeningProjectId(projectId);
    try {
      const project = await window.electronAPI.project.load(projectId);

      const parts = project.parts ?? [];
      if (parts.length === 0) {
        navigate(`/projects/${projectId}/article`);
        return;
      }

      const hasAnyAudio = parts.some((p) => Boolean(p.audio));
      const hasAnyImages = parts.some((p) => (p.panelImages?.length ?? 0) > 0);
      const allHaveAudio = parts.every((p) => Boolean(p.audio));
      const allHaveImages = parts.every((p) => (p.panelImages?.length ?? 0) > 0);
      const hasAnyPrompt = (project.prompts?.length ?? 0) > 0;
      const hasAnyGeneratedImage = (project.images?.length ?? 0) > 0;

      if (allHaveAudio && allHaveImages) {
        navigate(`/projects/${projectId}/video`);
      } else if (hasAnyAudio) {
        navigate(`/projects/${projectId}/audio`);
      } else if (hasAnyImages || hasAnyPrompt || hasAnyGeneratedImage) {
        navigate(`/projects/${projectId}/image`);
      } else {
        navigate(`/projects/${projectId}/script`);
      }
    } catch (error) {
      console.error('Failed to open project:', error);
      navigate(`/projects/${projectId}/article`);
    } finally {
      setOpeningProjectId(null);
    }
  };

  const filteredProjects = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter((project) => {
      const haystack = `${project.name} ${project.articleTitle ?? ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [projects, search]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ja-JP');
  };

  const deleteTarget = projects.find((p) => p.id === deleteTargetId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="プロジェクト" subtitle="進行状況と不足項目を見ながら再開できます" />

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <Card
            title="新規プロジェクト"
            subtitle="タイトルを入力してすぐに記事作成を開始"
            actions={
              <Button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || isCreating}
                variant="primary"
              >
                {isCreating ? '作成中...' : '作成'}
              </Button>
            }
          >
            <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="例: 日米金利差と為替の関係"
                className="nv-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateProject();
                  }
                }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="検索（プロジェクト名 / 記事タイトル）"
                className="nv-input"
              />
            </div>
          </Card>

          <Card title="プロジェクト一覧" subtitle={`${filteredProjects.length}件`}>
            <div className="space-y-2">
              {isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              )}

              {!isLoading && filteredProjects.length === 0 && (
                <EmptyState
                  title="表示できるプロジェクトがありません"
                  description="新規プロジェクトを作成するか、検索条件を変更してください。"
                />
              )}

              {!isLoading &&
                filteredProjects.map((project) => {
                  const summary = project.summary;
                  const isOpening = openingProjectId === project.id;

                  return (
                    <div
                      key={project.id}
                      className="nv-surface-muted flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900">
                            {project.name}
                          </h3>
                          {summary ? (
                            <StatusChip
                              tone={summary.hasVideoOutput ? 'success' : 'info'}
                              label={
                                summary.hasVideoOutput ? '完成' : `次: ${stageLabel(summary.stage)}`
                              }
                            />
                          ) : (
                            <Badge tone="neutral">旧データ</Badge>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>更新: {formatDate(project.updatedAt)}</span>
                          <span>作成: {formatDate(project.createdAt)}</span>
                          {project.articleTitle && (
                            <span className="truncate">記事: {project.articleTitle}</span>
                          )}
                        </div>

                        {summary && (
                          <div className="mt-2 grid gap-2 md:grid-cols-[2fr_1fr] md:items-center">
                            <ProgressBar
                              value={summary.completedSteps}
                              max={summary.totalSteps}
                              label={`進捗 ${summary.completedSteps}/${summary.totalSteps}`}
                              tone={summary.hasVideoOutput ? 'success' : 'accent'}
                            />
                            <div className="flex items-center gap-1 text-[11px] text-slate-600">
                              <Badge tone="warning">未プロンプト {summary.missingPrompts}</Badge>
                              <Badge tone="warning">未画像 {summary.missingImages}</Badge>
                              <Badge tone="warning">未音声 {summary.missingAudio}</Badge>
                              <Badge tone={summary.hasVideoOutput ? 'success' : 'neutral'}>
                                {nextActionLabel(summary)}
                              </Badge>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="primary"
                          onClick={() => handleOpenProject(project.id)}
                          disabled={isOpening}
                        >
                          {isOpening ? '開いています...' : '再開'}
                        </Button>
                        <Button variant="secondary" onClick={() => setDeleteTargetId(project.id)}>
                          削除
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="プロジェクトを削除しますか？"
        description={
          deleteTarget ? `「${deleteTarget.name}」を削除します。この操作は取り消せません。` : ''
        }
        confirmLabel="削除"
        onConfirm={() => {
          void handleDeleteProject();
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
