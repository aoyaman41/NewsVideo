import { useScrollMemory } from '../hooks/useScrollMemory';
import { FinishingEditor } from '../components/script/FinishingEditor';
import { SceneStudio } from '../components/script/SceneStudio';
import { EvidenceReview } from '../components/script/EvidenceReview';
import { AssetRights } from '../components/script/AssetRights';
import { useSceneSelection, rememberedScene } from '../stores/sceneSelection';
import { AssetReview } from '../components/script/AssetReview';
import { projectClient, useProjectState, useProjectSaveStatus } from '../stores/projectStore';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { PartList, ScriptEditor } from '../components/script';
import { Button, EmptyState, ErrorDetailPanel, useToast } from '../components/ui';
import type { PartEdit } from '../schemas';
import { createNewPart } from '../schemas';
import { createOpenAIUsageRecord } from '../utils/usage';

export function ScriptEditPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [project, setProject] = useProjectState(projectId);
  const [selectedPartId, setSelectedPartId] = useSceneSelection(projectId);
  const scrollRef = useScrollMemory(`${projectId}:script:${selectedPartId}`);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCommentAppliedAt, setLastCommentAppliedAt] = useState<string | null>(null);
  const [lastDiffByPart, setLastDiffByPart] = useState<
    Record<string, { before: string; after: string }>
  >({});

  const reportError = useCallback(
    (message: string, title?: string) => {
      setError(message);
      toast.error(message, title);
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
        reportError('プロジェクトの読み込みに失敗しました', '読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    void loadProject();
  }, [projectId, reportError, setProject, setSelectedPartId]);

  const saveStatus = useProjectSaveStatus(projectId);
  const autoSaveState = {
    isDirty: saveStatus.dirty,
    isSaving: saveStatus.saving,
    lastSavedAt: saveStatus.lastSavedAt ? new Date(saveStatus.lastSavedAt) : null,
    saveNow: saveStatus.retry,
  };

  const handleAddPart = useCallback(async () => {
    if (!project) return;

    const newPart = createNewPart(project.parts.length);
    const updatedProject = {
      ...project,
      parts: [...project.parts, newPart],
      updatedAt: new Date().toISOString(),
    };
    setProject(updatedProject);
    setSelectedPartId(newPart.id);
    try {
      await projectClient.save(updatedProject);
    } catch (err) {
      console.error('Failed to save project after adding part:', err);
      reportError('パート追加の保存に失敗しました');
    }
  }, [project, reportError, setProject, setSelectedPartId]);

  const handleDeletePart = useCallback(
    async (partId: string) => {
      if (!project) return;

      const updatedParts = project.parts
        .filter((p) => p.id !== partId)
        .map((p, index) => ({ ...p, index }));

      const updatedProject = {
        ...project,
        parts: updatedParts,
        updatedAt: new Date().toISOString(),
      };
      setProject(updatedProject);

      if (selectedPartId === partId) {
        setSelectedPartId(updatedParts.length > 0 ? updatedParts[0].id : null);
      }
      try {
        await projectClient.save(updatedProject);
      } catch (err) {
        console.error('Failed to save project after deleting part:', err);
        reportError('パート削除の保存に失敗しました');
      }
    },
    [project, reportError, selectedPartId, setProject, setSelectedPartId]
  );

  const handleReorderParts = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!project) return;

      const newParts = [...project.parts];
      const [movedPart] = newParts.splice(fromIndex, 1);
      newParts.splice(toIndex, 0, movedPart);
      const updatedParts = newParts.map((p, index) => ({ ...p, index }));

      const updatedProject = {
        ...project,
        parts: updatedParts,
        updatedAt: new Date().toISOString(),
      };
      setProject(updatedProject);
      try {
        await projectClient.save(updatedProject);
      } catch (err) {
        console.error('Failed to save project after reordering parts:', err);
        reportError('パート並び替えの保存に失敗しました');
      }
    },
    [project, reportError, setProject]
  );

  const handleSavePart = useCallback(
    (partId: string, data: PartEdit) => {
      if (!project) return;

      const updatedParts = project.parts.map((p) =>
        p.id === partId
          ? {
              ...p,
              title: data.title,
              summary: data.summary ?? '',
              scriptText: data.scriptText,
              scriptModifiedByUser: true,
              updatedAt: new Date().toISOString(),
            }
          : p
      );

      setProject({
        ...project,
        parts: updatedParts,
        updatedAt: new Date().toISOString(),
      });
    },
    [project, setProject]
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

        const updatedParts = project.parts.map((p) =>
          p.id === partId
            ? {
                ...p,
                scriptText: result.text,
                updatedAt: new Date().toISOString(),
                comments: [
                  ...p.comments,
                  {
                    id: crypto.randomUUID(),
                    text: comment,
                    createdAt: new Date().toISOString(),
                    appliedAt: new Date().toISOString(),
                  },
                ],
              }
            : p
        );

        setProject({
          ...project,
          parts: updatedParts,
          usage: usageRecord ? [...(project.usage ?? []), usageRecord] : (project.usage ?? []),
          updatedAt: new Date().toISOString(),
        });

        setLastDiffByPart((prev) => ({
          ...prev,
          [partId]: { before, after: result.text },
        }));
        setLastCommentAppliedAt(new Date().toISOString());
      } catch (err) {
        console.error('Failed to regenerate script:', err);
        reportError(err instanceof Error ? err.message : 'スクリプト修正に失敗しました');
      } finally {
        setIsProcessing(false);
      }
    },
    [project, reportError, setProject]
  );

  const selectedPart = project?.parts.find((p) => p.id === selectedPartId) ?? null;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-slate-600">読み込み中...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="プロジェクトを読み込めません"
          description={error || 'プロジェクトが見つかりません'}
          action={<Button onClick={() => navigate('/projects')}>プロジェクト一覧に戻る</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="シーンと台本" subtitle={project.name} />

      {projectId && <WorkflowNav projectId={projectId} current="script" project={project} />}

      {error && (
        <div className="px-5 pt-4">
          <ErrorDetailPanel message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 lg:flex-row">
        <div className="max-h-48 shrink-0 lg:max-h-none lg:w-52 overflow-auto rounded-[12px] border border-[var(--nv-color-border)] bg-white">
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
          className="min-h-0 min-w-0 flex-1 overflow-auto rounded-[12px] border border-[var(--nv-color-border)] bg-[var(--nv-color-canvas)]"
        >
          {selectedPart ? (
            <>
              <div className="grid items-start gap-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <SceneStudio
                  key={`studio-${selectedPart.id}`}
                  project={project}
                  part={selectedPart}
                  onChange={setProject}
                />
                <ScriptEditor
                  key={selectedPart.id}
                  part={selectedPart}
                  onSave={handleSavePart}
                  onRegenerateWithComment={handleRegenerateWithComment}
                  isProcessing={isProcessing}
                  lastCommentAppliedAt={lastCommentAppliedAt}
                  autoSaveStatus={autoSaveState}
                  autoSaveDelayMs={1200}
                  diffPreview={lastDiffByPart[selectedPart.id] ?? null}
                />
              </div>
              <AssetReview project={project} part={selectedPart} onChange={setProject} />
              <FinishingEditor
                key={`finish-${selectedPart.id}`}
                project={project}
                part={selectedPart}
                onChange={setProject}
              />
              <EvidenceReview project={project} part={selectedPart} onChange={setProject} />
              <details className="p-3">
                <summary className="cursor-pointer text-sm">素材の由来と利用条件</summary>
                <AssetRights project={project} part={selectedPart} onChange={setProject} />
              </details>
            </>
          ) : (
            <div className="p-4">
              <EmptyState title="パートを選択してください" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
