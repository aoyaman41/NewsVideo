import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { PartList, ScriptEditor } from '../components/script';
import { useAutoSave } from '../hooks';
import type { Project, PartEdit } from '../schemas';
import { createNewPart } from '../schemas';
import { createOpenAIUsageRecord } from '../utils/usage';

export function ScriptEditPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCommentAppliedAt, setLastCommentAppliedAt] = useState<string | null>(null);

  // プロジェクト読み込み
  useEffect(() => {
    if (!projectId) return;

    const loadProject = async () => {
      setIsLoading(true);
      try {
        const loaded = await window.electronAPI.project.load(projectId);
        setProject(loaded);
        // 最初のパートを選択
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

    loadProject();
  }, [projectId]);

  // 自動保存
  const handleSave = useCallback(
    async (data: Project) => {
      try {
        await window.electronAPI.project.save(data);
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    },
    []
  );

  const autoSaveState = useAutoSave({
    data: project!,
    onSave: handleSave,
    interval: 1500,
    enabled: !!project,
  });

  // パート追加
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

  // パート削除
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

      // 削除したパートが選択されていた場合、次のパートを選択
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

  // パート並び替え
  const handleReorderParts = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!project) return;

      const newParts = [...project.parts];
      const [movedPart] = newParts.splice(fromIndex, 1);
      newParts.splice(toIndex, 0, movedPart);

      // インデックスを更新
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

  // パート保存
  const handleSavePart = useCallback(
    (partId: string, data: PartEdit) => {
      if (!project) return;

      const updatedParts = project.parts.map((p) =>
        p.id === partId
          ? {
              ...p,
              title: data.title,
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

  // コメントでスクリプト修正
  const handleRegenerateWithComment = useCallback(
    async (partId: string, comment: string) => {
      if (!project) return;

      const part = project.parts.find((p) => p.id === partId);
      if (!part) return;

      setIsProcessing(true);
      setError(null);

      try {
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
          usage: usageRecord ? [...(project.usage ?? []), usageRecord] : project.usage ?? [],
          updatedAt: new Date().toISOString(),
        });
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

  const selectedPart = project?.parts.find((p) => p.id === selectedPartId);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-red-500">{error || 'プロジェクトが見つかりません'}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="スクリプト"
        subtitle={project.name}
      />

      {projectId && <WorkflowNav projectId={projectId} current="script" project={project} />}

      {/* エラー表示 */}
      {error && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 text-red-500 hover:text-red-700"
          >
            ×
          </button>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左ペイン: パート一覧 */}
        <div className="w-72 border-r border-gray-200 bg-white overflow-hidden flex flex-col">
          <PartList
            parts={project.parts}
            selectedPartId={selectedPartId}
            onSelectPart={setSelectedPartId}
            onAddPart={handleAddPart}
            onDeletePart={handleDeletePart}
            onReorderParts={handleReorderParts}
          />
        </div>

        {/* 右ペイン: スクリプト編集 */}
        <div className="flex-1 bg-gray-50 overflow-hidden flex flex-col">
          {selectedPart ? (
            <ScriptEditor
              part={selectedPart}
              onSave={handleSavePart}
              onRegenerateWithComment={handleRegenerateWithComment}
              isProcessing={isProcessing}
              lastCommentAppliedAt={lastCommentAppliedAt}
              autoSaveStatus={autoSaveState}
              autoSaveDelayMs={1200}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              パートを選択してください
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
