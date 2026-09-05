import { PURPOSES } from '../../shared/project/purposes';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Skeleton,
  StatusChip,
  useConfirm,
  useToast,
} from '../components/ui';
import type { ProjectListItem } from '../types/ui';
import { nextActionLabel, stageLabel } from '../utils/projectHealth';

export function ProjectListPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [purpose, setPurpose] = useState<'short' | 'explain' | 'news'>('news');
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [trash, setTrash] = useState<Array<{ key: string; name: string }>>([]);
  const manage = async (request: Parameters<typeof window.electronAPI.project.manage>[0]) => {
    try {
      const result = await window.electronAPI.project.manage(request);
      if (request.action === 'trash') setTrash(result as Array<{ key: string; name: string }>);
      else {
        await loadProjects();
        setTrash([]);
        if (result)
          toast.success(
            request.action === 'export'
              ? `バックアップを保存しました: ${result}`
              : 'プロジェクトを更新しました'
          );
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

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

  const handleCreateProject = async (sample = false) => {
    setIsCreating(true);
    try {
      const created = await window.electronAPI.project.create({
        name: newProjectName.trim() || '新しい動画',
        purpose,
        sample,
      });
      navigate(`/projects/${created.id}/${sample ? 'video' : 'article'}`);
      setNewProjectName('');
      await loadProjects();
      toast.success('プロジェクトを作成しました');
    } catch (error) {
      console.error('Failed to create project:', error);
      toast.error(error instanceof Error ? error.message : '不明なエラー', '作成に失敗しました');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (project: ProjectListItem) => {
    const accepted = await confirm({
      title: 'プロジェクトを削除しますか？',
      description: `「${project.name}」を削除します。ゴミ箱へ移動します。`,
      confirmLabel: '削除',
      confirmVariant: 'danger',
    });
    if (!accepted) return;

    try {
      await window.electronAPI.project.delete(project.id);
      await loadProjects();
      toast.success('プロジェクトを削除しました');
    } catch (error) {
      console.error('Failed to delete project:', error);
      toast.error(error instanceof Error ? error.message : '不明なエラー', '削除に失敗しました');
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
    return projects.filter((project) => {
      if (Boolean(project.archived) !== showArchived) return false;
      if (!keyword) return true;
      const haystack = `${project.name} ${project.articleTitle ?? ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [projects, search, showArchived]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ja-JP');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="プロジェクト" subtitle="新規作成と作業再開" />

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <details open={projects.length === 0} className="space-y-3">
            <summary className="cursor-pointer text-base font-semibold text-slate-800">
              新しく制作する・サンプルを試す
            </summary>
            <Card title="新規プロジェクト" subtitle="用途を選び、記事から制作を始めましょう">
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  {PURPOSES.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={purpose === item.id}
                      onClick={() => setPurpose(item.id)}
                      className={`rounded-lg border p-3 text-left text-sm ${purpose === item.id ? 'border-blue-700 bg-blue-50 font-semibold' : 'border-slate-300'}`}
                    >
                      {item.label}
                      <span className="mt-1 block text-xs">
                        {item.profile.aspectRatio} · {item.parts}シーン
                      </span>
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    aria-label="新規プロジェクト名"
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
                  <Button
                    onClick={() => void handleCreateProject()}
                    disabled={isCreating}
                    variant="primary"
                  >
                    {isCreating ? '作成中...' : '作成'}
                  </Button>
                </div>
                <div className="text-xs text-slate-600">
                  名前は省略できます。記事タイトルを入力すると名前に反映します。声と見た目は制作画面で調整できます。
                </div>
              </div>
            </Card>

            <Card
              title="APIキーなしで試す"
              subtitle="完成サンプルをローカルで作り、原稿・画像・カットを編集できます"
            >
              <Button
                variant="secondary"
                disabled={isCreating}
                onClick={() => void handleCreateProject(true)}
              >
                {isCreating ? '準備しています…' : '編集サンプルを開く'}
              </Button>
              <p className="mt-2 text-sm text-slate-600">
                macOSの音声と同梱の図形を使います。AIで新しく生成する場合だけ、選択したサービスのキーが必要です。
              </p>
            </Card>
          </details>
          {projects.length > 0 && (
            <Card title="検索と再開" subtitle="プロジェクト名や記事タイトルで絞り込み">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <input
                  aria-label="プロジェクト検索"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="検索（プロジェクト名 / 記事タイトル）"
                  className="nv-input"
                />
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Badge tone="info">{filteredProjects.length}件</Badge>
                  {search.trim() ? (
                    <span>「{search.trim()}」で絞り込み中</span>
                  ) : (
                    <span>全プロジェクトを表示</span>
                  )}
                </div>
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />{' '}
              アーカイブを表示
            </label>
            <Button variant="secondary" size="sm" onClick={() => void manage({ action: 'import' })}>
              バックアップから復元
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void manage({ action: 'trash' })}>
              ごみ箱
            </Button>
          </div>
          {trash.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-2 rounded border p-3 text-sm"
            >
              <span>{item.name}</span>
              <Button size="sm" onClick={() => void manage({ action: 'restore', key: item.key })}>
                復元
              </Button>
            </div>
          ))}
          {projects.length > 0 && (
            <details className="rounded-lg border bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                このMacの制作記録（外部送信なし）
              </summary>
              <div className="mt-3 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th>制作</th>
                      <th>初回出力まで</th>
                      <th>台本編集率</th>
                      <th>生成要求</th>
                      <th>再開・停止</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects
                      .filter((item) => item.metrics)
                      .map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="py-2">{item.name}</td>
                          <td>
                            {item.metrics!.elapsedToOutputSec === null
                              ? '未計測'
                              : `${Math.round(item.metrics!.elapsedToOutputSec!)}秒`}
                          </td>
                          <td>
                            {item.metrics!.editedSceneRatio === null
                              ? '未計測'
                              : `${Math.round(item.metrics!.editedSceneRatio! * 100)}%`}
                          </td>
                          <td>{item.metrics!.generationRequests}</td>
                          <td>
                            {item.metrics!.restarts} / {item.metrics!.stops}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                経過時間には待機・中断時間を含みます。旧版の未記録値は0として比較せず、未計測として扱います。
              </p>
            </details>
          )}
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
                  const blockers = summary
                    ? [
                        summary.missingPrompts > 0 ? `プロンプト ${summary.missingPrompts}` : null,
                        summary.missingImages > 0 ? `画像 ${summary.missingImages}` : null,
                        summary.missingAudio > 0 ? `音声 ${summary.missingAudio}` : null,
                      ].filter((value): value is string => value != null)
                    : [];

                  return (
                    <div key={project.id} className="nv-surface-muted px-4 py-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          {project.thumbnailPath && (
                            <img
                              src={toLocalFileUrl(project.thumbnailPath)}
                              alt="先頭シーン"
                              className="mb-2 h-24 w-40 rounded object-cover"
                            />
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-slate-900">
                              {project.name}
                              {project.template ? '（テンプレート）' : ''}
                            </h3>
                            {summary ? (
                              <StatusChip
                                tone={summary.hasVideoOutput ? 'success' : 'info'}
                                label={
                                  summary.hasVideoOutput
                                    ? '完成'
                                    : `次: ${stageLabel(summary.stage)}`
                                }
                              />
                            ) : (
                              <Badge tone={project.storageError ? 'danger' : 'neutral'}>
                                {project.storageError ? '読み込みに問題があります' : '旧データ'}
                              </Badge>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                            <span>更新: {formatDate(project.updatedAt)}</span>
                            <span>
                              完成尺:{' '}
                              {project.durationSec === undefined
                                ? '未計測'
                                : `${Math.round(project.durationSec)}秒`}
                            </span>
                            <span>最終出力: {project.lastVideoPath ? 'あり' : '未出力'}</span>
                            {project.articleTitle && (
                              <span className="truncate">記事: {project.articleTitle}</span>
                            )}
                          </div>

                          {project.storageError && (
                            <p role="alert" className="mt-2 text-sm text-red-700">
                              {project.storageError}
                            </p>
                          )}
                          {summary && (
                            <div className="mt-3 space-y-2">
                              <ProgressBar
                                value={summary.completedSteps}
                                max={summary.totalSteps}
                                label={`進捗 ${summary.completedSteps}/${summary.totalSteps}`}
                                tone={summary.hasVideoOutput ? 'success' : 'accent'}
                              />
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <span>次の一手: {nextActionLabel(summary)}</span>
                                {blockers.length > 0 && <span>不足: {blockers.join(' / ')}</span>}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Button
                            variant="primary"
                            onClick={() => handleOpenProject(project.id)}
                            disabled={isOpening || Boolean(project.storageError)}
                          >
                            {isOpening ? '開いています...' : '再開'}
                          </Button>
                          <details className="relative text-sm">
                            <summary className="cursor-pointer rounded border px-3 py-2">
                              管理
                            </summary>
                            <div className="mt-2 flex flex-col gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void manage({ action: 'clone', id: project.id })}
                              >
                                複製
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  void manage({ action: 'clone', id: project.id, template: true })
                                }
                              >
                                用途・ブランドをテンプレート保存
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  void manage({
                                    action: 'archive',
                                    id: project.id,
                                    archived: !project.archived,
                                  })
                                }
                              >
                                {project.archived ? 'アーカイブを戻す' : 'アーカイブ'}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void manage({ action: 'export', id: project.id })}
                              >
                                素材込みバックアップ
                              </Button>
                            </div>
                          </details>
                          <Button
                            variant="secondary"
                            disabled={Boolean(project.storageError)}
                            onClick={() => void handleDeleteProject(project)}
                          >
                            削除
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
