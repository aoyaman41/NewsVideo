import {
  DEFAULT_PURPOSE_ID,
  PURPOSES,
  describePurpose,
  type PurposeId,
} from '../../shared/project/purposes';
import { normalizeSettings } from '../../shared/settings/appSettings';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/layout';
import { nextStepHint } from '../components/layout/workflowLabels';
import { FriendlyError } from '../components/errors/FriendlyError';
import { errorToastContent, explainError } from '../components/errors/explainError';
import { isJobActive } from '../components/job/jobDisplay';
import { MoreMenu } from '../components/project/MoreMenu';
import {
  Button,
  Card,
  Details,
  EmptyState,
  Skeleton,
  StatusChip,
  useConfirm,
  useToast,
} from '../components/ui';
import { useJobFeed } from '../stores/jobStore';
import type { ProjectListItem, Tone } from '../types/ui';
import { cx } from '../utils/cx';

type Purpose = PurposeId;

type ManageAction = Parameters<typeof window.electronAPI.project.manage>[0]['action'];

// 「…」メニューの操作に失敗したときの通知の見出し
const MANAGE_FAILURE_TITLES: Record<ManageAction, string> = {
  clone: '複製できませんでした',
  archive: 'アーカイブを切り替えられませんでした',
  export: 'バックアップを保存できませんでした',
  import: 'バックアップから復元できませんでした',
  trash: 'ごみ箱を開けませんでした',
  restore: '元に戻せませんでした',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export function ProjectListPage() {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  const feed = useJobFeed();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // 最初に選ばれている用途は、設定の「新しい動画」の既定値
  const [purpose, setPurpose] = useState<Purpose>(DEFAULT_PURPOSE_ID);
  const [purposeTouched, setPurposeTouched] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [trash, setTrash] = useState<Array<{ key: string; name: string }> | null>(null);

  const showError = useCallback(
    (error: unknown, title: string) => {
      const content = errorToastContent(explainError(error), title);
      toast.error(content.message, content.title);
    },
    [toast]
  );

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      setProjects(await window.electronAPI.project.list());
      setLoadError(null);
    } catch (error) {
      console.error('Failed to load projects:', error);
      setLoadError(error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    let active = true;
    void window.electronAPI.settings
      .get()
      .then((value) => {
        if (active && !purposeTouched)
          setPurpose(normalizeSettings(value).newProjectDefaults.purpose);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [purposeTouched]);

  const manage = async (request: Parameters<typeof window.electronAPI.project.manage>[0]) => {
    try {
      const result = await window.electronAPI.project.manage(request);
      if (request.action === 'trash') {
        setTrash((result as Array<{ key: string; name: string }>) ?? []);
        return;
      }
      await loadProjects();
      if (request.action === 'restore') {
        setTrash((previous) => previous?.filter((item) => item.key !== request.key) ?? null);
        toast.success('プロジェクトを元に戻しました');
        return;
      }
      if (!result) return; // ダイアログを閉じたとき
      const messages: Partial<Record<typeof request.action, string>> = {
        clone: 'プロジェクトを複製しました',
        archive: request.archived ? 'アーカイブしました' : 'アーカイブから戻しました',
        export: 'バックアップを保存しました',
        import: 'バックアップから復元しました',
      };
      toast.success(messages[request.action] ?? 'プロジェクトを更新しました');
    } catch (error) {
      console.error('Failed to manage project:', error);
      showError(error, MANAGE_FAILURE_TITLES[request.action]);
    }
  };

  const handleCreateProject = async (sample = false) => {
    setIsCreating(true);
    try {
      const created = await window.electronAPI.project.create({
        name: sample ? 'サンプル' : '新しい動画',
        purpose,
        sample,
      });
      navigate(`/projects/${created.id}/${sample ? 'video' : 'article'}`);
    } catch (error) {
      console.error('Failed to create project:', error);
      showError(error, sample ? 'サンプルを開けませんでした' : '作成できませんでした');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (project: ProjectListItem) => {
    const accepted = await confirm({
      title: 'ごみ箱へ移動しますか？',
      description: `「${project.name}」をごみ箱へ移動します。一覧の「…」メニューの「ごみ箱を開く」から元に戻せます。`,
      confirmLabel: 'ごみ箱へ移動',
      confirmVariant: 'danger',
    });
    if (!accepted) return;

    try {
      await window.electronAPI.project.delete(project.id);
      await loadProjects();
      toast.success('ごみ箱へ移動しました');
    } catch (error) {
      console.error('Failed to delete project:', error);
      showError(error, 'ごみ箱へ移動できませんでした');
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

  const hasProjects = projects.length > 0;
  const createOpen = showCreate || (!isLoading && !hasProjects && !loadError);

  const statusOf = (project: ProjectListItem): { tone: Tone; label: string } => {
    if (project.storageError) return { tone: 'danger', label: '読み込めません' };
    if (isJobActive(feed.jobs.get(project.id)?.job)) return { tone: 'info', label: '生成中' };
    if (!project.summary) return { tone: 'neutral', label: '旧データ' };
    if (project.summary.hasVideoOutput) return { tone: 'success', label: '完成' };
    return { tone: 'neutral', label: '作成途中' };
  };

  const createPanel = (
    <Card
      title="新しい動画を作る"
      subtitle="どんな動画にするかを選んでください。あとから変えられます。"
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="動画の種類" className="grid gap-2 sm:grid-cols-3">
          {PURPOSES.map((item) => {
            const id = item.id as Purpose;
            const selected = purpose === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setPurposeTouched(true);
                  setPurpose(id);
                }}
                className={cx(
                  'nv-focus-ring rounded-[var(--nv-radius-sm)] border p-3 text-left transition-colors duration-[var(--nv-duration-fast)]',
                  selected
                    ? 'border-[var(--nv-color-accent)] bg-[var(--nv-color-canvas)]'
                    : 'border-[var(--nv-color-border)] hover:bg-[var(--nv-color-canvas)]'
                )}
              >
                <span className="block text-sm font-semibold text-[var(--nv-color-text)]">
                  {selected ? '● ' : '○ '}
                  {item.label}
                </span>
                <span className="mt-1 block text-xs text-[var(--nv-color-muted)]">
                  {describePurpose(item)}。{item.note}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--nv-color-muted)]">
            次の画面で記事を貼り付けます。名前は記事のタイトルから自動で付きます。
          </p>
          <div className="flex gap-2">
            {hasProjects && (
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                キャンセル
              </Button>
            )}
            <Button size="lg" onClick={() => void handleCreateProject()} disabled={isCreating}>
              {isCreating ? '作成しています…' : '作成して記事を入力する'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nv-color-border)] pt-3">
          <p className="text-xs text-[var(--nv-color-muted)]">
            API キーがなくても、完成したサンプルを開いて操作を試せます。
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={isCreating}
            onClick={() => void handleCreateProject(true)}
          >
            サンプルを開く
          </Button>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header
        title="プロジェクト"
        actions={
          <>
            {hasProjects && !createOpen && (
              <Button onClick={() => setShowCreate(true)}>新しい動画を作る</Button>
            )}
            <MoreMenu
              label="プロジェクト一覧のその他の操作"
              items={[
                {
                  key: 'archived',
                  label: showArchived ? 'アーカイブを隠す' : 'アーカイブしたものを表示',
                  onSelect: () => setShowArchived((value) => !value),
                },
                {
                  key: 'import',
                  label: 'バックアップから復元',
                  onSelect: () => void manage({ action: 'import' }),
                },
                {
                  key: 'trash',
                  label: 'ごみ箱を開く',
                  onSelect: () => void manage({ action: 'trash' }),
                },
                {
                  key: 'sample',
                  label: 'サンプルを開く',
                  disabled: isCreating,
                  onSelect: () => void handleCreateProject(true),
                },
              ]}
            />
          </>
        }
      />

      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {loadError !== null && (
            <FriendlyError
              title="プロジェクトの一覧を読み込めませんでした"
              error={loadError}
              onRetry={() => void loadProjects()}
            />
          )}

          {createOpen && createPanel}

          {trash && (
            <Card
              title="ごみ箱"
              subtitle="元に戻すと一覧に表示されます"
              actions={
                <Button size="sm" variant="ghost" onClick={() => setTrash(null)}>
                  閉じる
                </Button>
              }
            >
              {trash.length === 0 ? (
                <p className="text-sm text-[var(--nv-color-muted)]">ごみ箱は空です。</p>
              ) : (
                <ul className="divide-y divide-[var(--nv-color-border)]">
                  {trash.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="truncate text-[var(--nv-color-text)]">{item.name}</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void manage({ action: 'restore', key: item.key })}
                      >
                        元に戻す
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {showArchived && (
            <div className="flex items-center justify-between gap-2 text-sm text-[var(--nv-color-muted)]">
              <span>アーカイブしたプロジェクトを表示しています。</span>
              <Button size="sm" variant="ghost" onClick={() => setShowArchived(false)}>
                通常の一覧に戻る
              </Button>
            </div>
          )}

          {hasProjects && (
            <input
              aria-label="プロジェクトを検索"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="名前や記事のタイトルで探す"
              className="nv-input"
            />
          )}

          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {!isLoading && hasProjects && filteredProjects.length === 0 && (
            <EmptyState
              title={
                search.trim() ? '見つかりませんでした' : 'ここにはまだプロジェクトがありません'
              }
              description={search.trim() ? '別の言葉で探してください。' : undefined}
            />
          )}

          {!isLoading && filteredProjects.length > 0 && (
            <ul className="space-y-2" aria-label="プロジェクト">
              {filteredProjects.map((project) => {
                const status = statusOf(project);
                const isOpening = openingProjectId === project.id;
                const meta = [
                  project.summary && !project.storageError ? nextStepHint(project.summary) : null,
                  `更新 ${formatDate(project.updatedAt)}`,
                  project.durationSec !== undefined
                    ? `${Math.round(project.durationSec)} 秒`
                    : null,
                ].filter(Boolean);
                return (
                  <li key={project.id} className="nv-surface flex items-center gap-4 p-3">
                    {project.thumbnailPath ? (
                      <img
                        src={toLocalFileUrl(project.thumbnailPath)}
                        alt=""
                        className="h-16 w-28 shrink-0 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-border)] object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="h-16 w-28 shrink-0 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-border)] bg-[var(--nv-color-canvas)]"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-[var(--nv-color-text)]">
                          {project.name}
                          {project.template ? '(テンプレート)' : ''}
                        </h3>
                        <StatusChip tone={status.tone} label={status.label} className="shrink-0" />
                      </div>
                      {project.articleTitle && project.articleTitle !== project.name && (
                        <p className="mt-0.5 truncate text-xs text-[var(--nv-color-muted)]">
                          記事: {project.articleTitle}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-[var(--nv-color-muted)]">
                        {meta.join(' ・ ')}
                      </p>
                      {project.storageError && (
                        <Details
                          className="mt-2"
                          summary={
                            <span className="text-[var(--nv-color-danger)]">
                              保存データを読み込めませんでした
                            </span>
                          }
                        >
                          <p className="break-all text-xs text-[var(--nv-color-muted)]">
                            {project.storageError}
                          </p>
                        </Details>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        onClick={() => void handleOpenProject(project.id)}
                        disabled={isOpening || Boolean(project.storageError)}
                      >
                        {isOpening ? '開いています…' : '開く'}
                      </Button>
                      <MoreMenu
                        label={`「${project.name}」のその他の操作`}
                        items={[
                          {
                            key: 'clone',
                            label: '複製',
                            disabled: Boolean(project.storageError),
                            onSelect: () => void manage({ action: 'clone', id: project.id }),
                          },
                          {
                            key: 'template',
                            label: 'テンプレートとして複製(記事なし・見た目と設定だけ)',
                            disabled: Boolean(project.storageError),
                            onSelect: () =>
                              void manage({ action: 'clone', id: project.id, template: true }),
                          },
                          {
                            key: 'archive',
                            label: project.archived ? 'アーカイブから戻す' : 'アーカイブする',
                            onSelect: () =>
                              void manage({
                                action: 'archive',
                                id: project.id,
                                archived: !project.archived,
                              }),
                          },
                          {
                            key: 'export',
                            label: 'バックアップを保存(素材ごと)',
                            disabled: Boolean(project.storageError),
                            onSelect: () => void manage({ action: 'export', id: project.id }),
                          },
                          {
                            key: 'delete',
                            label: 'ごみ箱へ移動',
                            danger: true,
                            disabled: Boolean(project.storageError),
                            onSelect: () => void handleDeleteProject(project),
                          },
                        ]}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
