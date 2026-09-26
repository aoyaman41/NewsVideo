import { useScrollMemory } from '../hooks/useScrollMemory';
import { useSceneSelection, rememberedScene } from '../stores/sceneSelection';
import { projectClient, useProjectState } from '../stores/projectStore';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { PartList, ScenePreview, ScriptEditor } from '../components/script';
import { Button, EmptyState, useConfirm, useToast } from '../components/ui';
import { StaleNotice } from '../components/common/StaleNotice';
import { NarrationOverrideNotice } from '../components/common/NarrationOverrideNotice';
import { ErrorNotice } from '../components/common/ErrorNotice';
import { describeError, type FriendlyError } from '../components/common/friendlyError';
import { JOB_ACTIVE_MESSAGE, useJobActive } from '../components/common/useJobActive';
import type { PartEdit, Project } from '../schemas';
import { createNewPart } from '../schemas';
import { mergeSceneWithNext } from '../../shared/project/scenes';
import { createOpenAIUsageRecord } from '../utils/usage';

export function ScriptEditPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [project, setProject] = useProjectState(projectId);
  const [selectedPartId, setSelectedPartId] = useSceneSelection(projectId);
  const scrollRef = useScrollMemory(`${projectId}:script:${selectedPartId}`);
  const jobActive = useJobActive(projectId, project);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [lastDiffByPart, setLastDiffByPart] = useState<
    Record<string, { before: string; after: string }>
  >({});

  const reportError = useCallback(
    (err: unknown, title: string) => {
      console.error(title, err);
      const friendly = describeError(err, title);
      setError(friendly);
      toast.error(friendly.message, friendly.title);
    },
    [toast]
  );

  useEffect(() => {
    if (!projectId) return;
    const loadProject = async () => {
      setIsLoading(true);
      try {
        const loaded = await projectClient.load(projectId);
        setProject(loaded);
        if (loaded.parts.length > 0) {
          setSelectedPartId(rememberedScene(projectId, loaded.parts));
        }
      } catch (err) {
        console.error('Failed to load project:', err);
        setLoadError(describeError(err, '読み込めませんでした').message);
      } finally {
        setIsLoading(false);
      }
    };
    void loadProject();
  }, [projectId, setProject, setSelectedPartId]);

  const saveStructure = useCallback(
    async (updated: Project, failureTitle: string) => {
      setProject(updated);
      try {
        await projectClient.save(updated);
      } catch (err) {
        reportError(err, failureTitle);
      }
    },
    [reportError, setProject]
  );

  const handleAddPart = useCallback(async () => {
    if (!project) return;
    const index = project.parts.length;
    const newPart = createNewPart(index, { title: `シーン ${index + 1}` });
    setSelectedPartId(newPart.id);
    await saveStructure(
      { ...project, parts: [...project.parts, newPart], updatedAt: new Date().toISOString() },
      'シーンを追加できませんでした'
    );
  }, [project, saveStructure, setSelectedPartId]);

  const handleDeletePart = useCallback(
    async (partId: string) => {
      if (!project) return;
      const updatedParts = project.parts
        .filter((p) => p.id !== partId)
        .map((p, index) => ({ ...p, index }));
      if (selectedPartId === partId) {
        setSelectedPartId(updatedParts.length > 0 ? updatedParts[0].id : null);
      }
      await saveStructure(
        { ...project, parts: updatedParts, updatedAt: new Date().toISOString() },
        'シーンを削除できませんでした'
      );
    },
    [project, saveStructure, selectedPartId, setSelectedPartId]
  );

  const handleReorderParts = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!project) return;
      const newParts = [...project.parts];
      const [movedPart] = newParts.splice(fromIndex, 1);
      newParts.splice(toIndex, 0, movedPart);
      await saveStructure(
        {
          ...project,
          parts: newParts.map((p, index) => ({ ...p, index })),
          updatedAt: new Date().toISOString(),
        },
        'シーンを並べ替えられませんでした'
      );
    },
    [project, saveStructure]
  );

  const handleMergeNext = useCallback(
    async (partId: string) => {
      if (!project) return;
      const index = project.parts.findIndex((p) => p.id === partId);
      const next = project.parts[index + 1];
      if (!next) return;
      const accepted = await confirm({
        title: '次のシーンとまとめますか?',
        description: `「${next.title}」の台本と画像をこのシーンの後ろにつなげます。まとめたシーンの音声は作り直しが必要です。`,
        confirmLabel: 'まとめる',
        confirmVariant: 'primary',
      });
      if (!accepted) return;
      try {
        await saveStructure(
          { ...mergeSceneWithNext(project, partId), updatedAt: new Date().toISOString() },
          'シーンをまとめられませんでした'
        );
      } catch (err) {
        reportError(err, 'シーンをまとめられませんでした');
      }
    },
    [confirm, project, reportError, saveStructure]
  );

  const handleSavePart = useCallback(
    (partId: string, data: PartEdit) => {
      const now = new Date().toISOString();
      setProject((prev) =>
        prev
          ? {
              ...prev,
              parts: prev.parts.map((p) =>
                p.id === partId
                  ? {
                      ...p,
                      title: data.title,
                      summary: data.summary ?? '',
                      scriptText: data.scriptText,
                      scriptModifiedByUser: true,
                      updatedAt: now,
                    }
                  : p
              ),
              updatedAt: now,
            }
          : prev
      );
    },
    [setProject]
  );

  const handleRegenerateWithComment = useCallback(
    async (partId: string, comment: string) => {
      if (!project) return;
      const part = project.parts.find((p) => p.id === partId);
      if (!part) return;

      setIsProcessing(true);
      setError(null);
      try {
        const before = part.scriptText;
        const result = await window.electronAPI.ai.applyComment(
          { type: 'script', id: partId, currentText: part.scriptText },
          comment
        );
        const usageRecord = createOpenAIUsageRecord('script_comment', result.usage);
        const now = new Date().toISOString();
        // 待っている間に台本が編集されていたら、その編集を消さないよう書き直しは反映しない
        let applied = false;
        setProject((prev) => {
          if (!prev) return prev;
          const current = prev.parts.find((p) => p.id === partId);
          const usage = usageRecord ? [...(prev.usage ?? []), usageRecord] : (prev.usage ?? []);
          if (!current || current.scriptText !== before) return { ...prev, usage, updatedAt: now };
          applied = true;
          return {
            ...prev,
            parts: prev.parts.map((p) =>
              p.id === partId
                ? {
                    ...p,
                    scriptText: result.text,
                    updatedAt: now,
                    comments: [
                      ...p.comments,
                      { id: crypto.randomUUID(), text: comment, createdAt: now, appliedAt: now },
                    ],
                  }
                : p
            ),
            usage,
            updatedAt: now,
          };
        });
        if (applied) {
          setLastDiffByPart((prev) => ({ ...prev, [partId]: { before, after: result.text } }));
        } else {
          toast.warning(
            '書き直しを待つ間に台本が変更されたため、書き直しは反映しませんでした。',
            '反映しませんでした'
          );
        }
      } catch (err) {
        reportError(err, '台本を書き直せませんでした');
      } finally {
        setIsProcessing(false);
      }
    },
    [project, reportError, setProject, toast]
  );

  const closeDiff = useCallback((partId: string) => {
    setLastDiffByPart((prev) => {
      const next = { ...prev };
      delete next[partId];
      return next;
    });
  }, []);

  const handleUndoRewrite = useCallback(
    (partId: string) => {
      const diff = lastDiffByPart[partId];
      if (!diff) return;
      const now = new Date().toISOString();
      setProject((prev) =>
        prev
          ? {
              ...prev,
              parts: prev.parts.map((p) =>
                p.id === partId ? { ...p, scriptText: diff.before, updatedAt: now } : p
              ),
              updatedAt: now,
            }
          : prev
      );
      closeDiff(partId);
      toast.info('書き直す前の台本に戻しました。', '元に戻しました');
    },
    [closeDiff, lastDiffByPart, setProject, toast]
  );

  const updateSelectedPart = useCallback(
    (partId: string, changes: Partial<Project['parts'][number]>) =>
      setProject((prev) =>
        prev
          ? {
              ...prev,
              parts: prev.parts.map((p) => (p.id === partId ? { ...p, ...changes } : p)),
            }
          : prev
      ),
    [setProject]
  );

  const selectedPart = project?.parts.find((p) => p.id === selectedPartId) ?? null;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[var(--nv-color-muted)]">読み込み中...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="プロジェクトを読み込めません"
          description={loadError || 'プロジェクトが見つかりません'}
          action={<Button onClick={() => navigate('/projects')}>プロジェクト一覧に戻る</Button>}
        />
      </div>
    );
  }

  const returnTo = `/projects/${project.id}/script`;
  const hasNext = selectedPart ? selectedPart.index < project.parts.length - 1 : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="台本" subtitle={project.name} />

      {projectId && <WorkflowNav projectId={projectId} current="script" project={project} />}

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <div className="nv-surface w-56 shrink-0 overflow-hidden">
          <PartList
            parts={project.parts}
            selectedPartId={selectedPartId}
            onSelectPart={setSelectedPartId}
            onAddPart={handleAddPart}
            onDeletePart={handleDeletePart}
            onReorderParts={handleReorderParts}
          />
        </div>

        <div
          ref={scrollRef}
          className="@container nv-scrollbar min-h-0 min-w-0 flex-1 space-y-4 overflow-auto pr-1"
        >
          <ErrorNotice error={error} onDismiss={() => setError(null)} returnTo={returnTo} />

          {selectedPart ? (
            <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0 space-y-3">
                <StaleNotice
                  project={project}
                  part={selectedPart}
                  kinds={['script', 'image', 'audio']}
                  onChange={setProject}
                  renderAction={(kind) =>
                    kind === 'script' ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`/projects/${project.id}/${kind}`)}
                      >
                        {kind === 'image' ? '画像を作り直す' : '音声を作り直す'}
                      </Button>
                    )
                  }
                />
                <NarrationOverrideNotice
                  part={selectedPart}
                  onUseScript={() =>
                    updateSelectedPart(selectedPart.id, { narrationText: undefined })
                  }
                />
                {selectedPart.graphic?.enabled && (
                  <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-border)] bg-white px-3 py-2"
                  >
                    <p className="min-w-0 flex-1 text-sm text-[var(--nv-color-text)]">
                      このシーンは、画像の上に見出しや数字を重ねて表示します。
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        updateSelectedPart(selectedPart.id, {
                          graphic: { ...selectedPart.graphic!, enabled: false },
                        })
                      }
                    >
                      重ねるのをやめる
                    </Button>
                  </div>
                )}
                <ScriptEditor
                  key={selectedPart.id}
                  part={selectedPart}
                  onSave={handleSavePart}
                  onRegenerateWithComment={handleRegenerateWithComment}
                  isProcessing={isProcessing}
                  rewriteBlockedReason={jobActive ? JOB_ACTIVE_MESSAGE : null}
                  diffPreview={lastDiffByPart[selectedPart.id] ?? null}
                  onUndoRewrite={() => handleUndoRewrite(selectedPart.id)}
                  onCloseDiff={() => closeDiff(selectedPart.id)}
                  onMergeNext={hasNext ? () => void handleMergeNext(selectedPart.id) : undefined}
                />
              </div>
              <ScenePreview
                key={`preview-${selectedPart.id}`}
                project={project}
                part={selectedPart}
                jobActive={jobActive}
                onError={(err) => reportError(err, 'プレビューを作れませんでした')}
              />
            </div>
          ) : (
            <EmptyState
              title={project.parts.length === 0 ? 'シーンがありません' : 'シーンを選んでください'}
              description={
                project.parts.length === 0
                  ? '記事画面の「おまかせで作る」で台本を作るか、左の「追加」からシーンを作れます。'
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
