import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { PartList, ScriptEditor } from '../components/script';
import { Badge, Card, EmptyState, StatusChip } from '../components/ui';
import { useAutoSave } from '../hooks';
import type { Project, PartEdit } from '../schemas';
import { createNewPart } from '../schemas';
import { createOpenAIUsageRecord } from '../utils/usage';
import { summarizeProjectProgress } from '../utils/projectHealth';

export function ScriptEditPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCommentAppliedAt, setLastCommentAppliedAt] = useState<string | null>(null);
  const [lastDiffByPart, setLastDiffByPart] = useState<
    Record<string, { before: string; after: string }>
  >({});

  useEffect(() => {
    if (!projectId) return;

    const loadProject = async () => {
      setIsLoading(true);
      try {
        const loaded = await window.electronAPI.project.load(projectId);
        setProject(loaded);
        if (loaded.parts.length > 0) {
          setSelectedPartId(loaded.parts[0].id);
        }
      } catch (err) {
        console.error('Failed to load project:', err);
        setError('プロジェクトの読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    void loadProject();
  }, [projectId]);

  const handleSave = useCallback(async (data: Project) => {
    try {
      await window.electronAPI.project.save(data);
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }, []);

  const autoSaveState = useAutoSave({
    data: project!,
    onSave: handleSave,
    interval: 1500,
    enabled: !!project,
  });

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
      await window.electronAPI.project.save(updatedProject);
    } catch (err) {
      console.error('Failed to save project after adding part:', err);
      setError('パート追加の保存に失敗しました');
    }
  }, [project]);

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
        await window.electronAPI.project.save(updatedProject);
      } catch (err) {
        console.error('Failed to save project after deleting part:', err);
        setError('パート削除の保存に失敗しました');
      }
    },
    [project, selectedPartId]
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
        await window.electronAPI.project.save(updatedProject);
      } catch (err) {
        console.error('Failed to save project after reordering parts:', err);
        setError('パート並び替えの保存に失敗しました');
      }
    },
    [project]
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
    [project]
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
        setError(err instanceof Error ? err.message : 'スクリプト修正に失敗しました');
      } finally {
        setIsProcessing(false);
      }
    },
    [project]
  );

  const selectedPart = project?.parts.find((p) => p.id === selectedPartId) ?? null;
  const summary = useMemo(() => (project ? summarizeProjectProgress(project) : null), [project]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">読み込み中...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-red-500">{error || 'プロジェクトが見つかりません'}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header
        title="スクリプト"
        subtitle={project.name}
        statusLabel={summary ? `未音声 ${summary.missingAudio}` : undefined}
        statusTone={summary && summary.missingAudio > 0 ? 'warning' : 'success'}
      />

      {projectId && <WorkflowNav projectId={projectId} current="script" project={project} />}

      {error && (
        <div className="mx-5 mt-4 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-500 hover:text-red-700">
            ×
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <div className="w-80 min-w-[280px] overflow-hidden rounded-[12px] border border-[var(--nv-color-border)] bg-white">
          <PartList
            parts={project.parts}
            selectedPartId={selectedPartId}
            onSelectPart={setSelectedPartId}
            onAddPart={handleAddPart}
            onDeletePart={handleDeletePart}
            onReorderParts={handleReorderParts}
          />
        </div>

        <div className="min-w-0 flex-1 overflow-auto rounded-[12px] border border-[var(--nv-color-border)] bg-[var(--nv-color-canvas)]">
          {selectedPart ? (
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
          ) : (
            <div className="p-4">
              <EmptyState title="パートを選択してください" />
            </div>
          )}
        </div>

        <div className="w-72 min-w-[260px] space-y-3 overflow-auto">
          <Card title="編集メモ" subtitle="この画面の使い方">
            <ul className="space-y-2 text-xs text-slate-600">
              <li>・要約と原稿を編集すると自動保存されます。</li>
              <li>・コメント修正でAI再生成できます。</li>
              <li>・差分は「再生成差分」に表示されます。</li>
            </ul>
          </Card>

          {selectedPart && (
            <Card title="選択中パート" subtitle={`No.${selectedPart.index + 1}`}>
              <div className="space-y-2 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span>タイトル</span>
                  <Badge tone="info" className="max-w-[140px] truncate">
                    {selectedPart.title}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>推定時間</span>
                  <StatusChip
                    tone="neutral"
                    label={`${Math.round(selectedPart.durationEstimateSec)}秒`}
                  />
                </div>
                <p className="rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 p-2 text-[11px] text-slate-500">
                  {selectedPart.summary || '要約が未設定です'}
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
