import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ImageAssignment, PromptEditor } from '../components/image';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorDetailPanel,
  useConfirm,
  useToast,
} from '../components/ui';
import type { Project, ImageAssetRef, ImagePrompt } from '../schemas';
import { createGeminiImageUsageRecordFromAssets, createOpenAIUsageRecord } from '../utils/usage';
import {
  IMAGE_ASPECT_RATIO_LABELS,
  IMAGE_STYLE_PRESET_LABELS,
} from '../../shared/project/imageStylePresets';

export function ImageManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [isGeneratingSinglePrompt, setIsGeneratingSinglePrompt] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const reportError = useCallback(
    (message: string, title?: string) => {
      setError(message);
      toast.error(message, title);
    },
    [toast]
  );

  const latestPromptByPartId = useMemo(() => {
    const map = new Map<string, ImagePrompt>();
    if (!project) return map;

    const activePartIds = new Set(project.parts.map((part) => part.id));

    for (const prompt of project.prompts) {
      if (!activePartIds.has(prompt.partId)) continue;

      const current = map.get(prompt.partId);
      if (!current || prompt.createdAt >= current.createdAt) {
        map.set(prompt.partId, prompt);
      }
    }

    return map;
  }, [project]);

  const activePrompts = useMemo(() => {
    if (!project) return [];
    const partPrompts = project.parts
      .map((part) => latestPromptByPartId.get(part.id))
      .filter((prompt): prompt is ImagePrompt => !!prompt);
    return partPrompts;
  }, [project, latestPromptByPartId]);

  const promptIdsWithAnyImage = useMemo(() => {
    const set = new Set<string>();
    if (!project) return set;
    for (const image of project.images) {
      if (image.metadata.promptId) set.add(image.metadata.promptId);
    }
    return set;
  }, [project]);

  const missingImagePromptCount = useMemo(() => {
    let missing = 0;
    for (const prompt of activePrompts) {
      if (!promptIdsWithAnyImage.has(prompt.id)) missing += 1;
    }
    return missing;
  }, [activePrompts, promptIdsWithAnyImage]);

  // プロジェクト読み込み
  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) return;

      try {
        setIsLoading(true);
        const loadedProject = await window.electronAPI.project.load(projectId);
        setProject(loadedProject);

        // 最初のパートを選択
        if (loadedProject.parts.length > 0) {
          setSelectedPartId(loadedProject.parts[0].id);
        }
      } catch (err) {
        console.error('Failed to load project:', err);
        reportError(
          err instanceof Error ? err.message : 'プロジェクトの読み込みに失敗しました',
          '読み込みに失敗しました'
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadProject();
  }, [projectId, reportError]);

  // 画像プロンプト生成
  const handleGeneratePrompts = useCallback(async () => {
    if (!project || project.parts.length === 0) return;

    try {
      setIsGeneratingPrompts(true);
      setError(null);

      const result = await window.electronAPI.ai.generateImagePrompts(
        project.parts,
        project.article,
        {
          stylePreset: project.presentationProfile.imageStylePreset,
          aspectRatio: project.presentationProfile.aspectRatio,
        }
      );
      const usageRecord = createOpenAIUsageRecord('image_prompt_generate', result.usage);

      // プロジェクトを更新
      const updatedProject = {
        ...project,
        prompts: [...project.prompts, ...result.prompts],
        usage: usageRecord ? [...(project.usage ?? []), usageRecord] : (project.usage ?? []),
        updatedAt: new Date().toISOString(),
      };

      await window.electronAPI.project.save(updatedProject);
      setProject(updatedProject);
    } catch (err) {
      console.error('Failed to generate prompts:', err);
      reportError(err instanceof Error ? err.message : 'プロンプト生成に失敗しました');
    } finally {
      setIsGeneratingPrompts(false);
    }
  }, [project, reportError]);

  const handleGeneratePromptForTarget = useCallback(
    async (targetId: string) => {
      if (!project) return;

      try {
        setIsGeneratingSinglePrompt(true);
        setError(null);

        const result = await window.electronAPI.ai.generateImagePromptForTarget(
          project.parts,
          project.article,
          targetId,
          {
            stylePreset: project.presentationProfile.imageStylePreset,
            aspectRatio: project.presentationProfile.aspectRatio,
          }
        );
        const usageRecord = createOpenAIUsageRecord('image_prompt_regenerate', result.usage);

        const updatedProject: Project = {
          ...project,
          prompts: [...project.prompts, result.prompt],
          usage: usageRecord ? [...(project.usage ?? []), usageRecord] : (project.usage ?? []),
          updatedAt: new Date().toISOString(),
        };

        await window.electronAPI.project.save(updatedProject);
        setProject(updatedProject);
      } catch (err) {
        console.error('Failed to generate prompt:', err);
        reportError(err instanceof Error ? err.message : 'プロンプト生成に失敗しました');
      } finally {
        setIsGeneratingSinglePrompt(false);
      }
    },
    [project, reportError]
  );

  // 画像生成
  const handleGenerateImage = useCallback(
    async (prompt: ImagePrompt) => {
      if (!project || !projectId) return;

      try {
        setIsGeneratingImage(true);
        setError(null);

        const imageAsset = await window.electronAPI.image.generate(prompt, projectId);
        const usageRecord = createGeminiImageUsageRecordFromAssets([imageAsset], 'image_generate');

        // プロジェクトを更新
        const now = new Date().toISOString();
        const updatedParts = project.parts.map((part) => {
          if (part.id !== prompt.partId) return part;
          // 初回は自動で割り当て（既に割り当てがある場合はユーザーの選択を尊重して変更しない）
          if ((part.panelImages?.length ?? 0) > 0) return part;
          return { ...part, panelImages: [{ imageId: imageAsset.id }], updatedAt: now };
        });

        const updatedProject: Project = {
          ...project,
          parts: updatedParts,
          images: [...project.images, imageAsset],
          usage: usageRecord ? [...(project.usage ?? []), usageRecord] : (project.usage ?? []),
          updatedAt: now,
        };

        await window.electronAPI.project.save(updatedProject);
        setProject(updatedProject);
      } catch (err) {
        console.error('Failed to generate image:', err);
        reportError(err instanceof Error ? err.message : '画像生成に失敗しました');
      } finally {
        setIsGeneratingImage(false);
      }
    },
    [project, projectId, reportError]
  );

  // 全パートの画像を一括生成
  const handleGenerateAllImages = useCallback(async () => {
    if (!project || !projectId) return;

    const targetPrompts = activePrompts.filter((prompt) => !promptIdsWithAnyImage.has(prompt.id));

    if (targetPrompts.length === 0) {
      setError(null);
      toast.info(
        '未生成の画像はありません。必要なら各パートで個別に生成してください。',
        '生成対象はありません'
      );
      return;
    }

    try {
      setIsGeneratingImage(true);
      setError(null);

      const imageAssets = await window.electronAPI.image.generateBatch(targetPrompts, projectId);
      const usageRecord = createGeminiImageUsageRecordFromAssets(
        imageAssets,
        'image_generate_batch'
      );

      // プロジェクトを更新
      const now = new Date().toISOString();
      const promptById = new Map(targetPrompts.map((p) => [p.id, p]));
      const nextPartsById = new Map(project.parts.map((p) => [p.id, p]));

      for (const imageAsset of imageAssets) {
        const promptId = imageAsset.metadata.promptId;
        if (!promptId) continue;
        const p = promptById.get(promptId);
        if (!p) continue;

        const part = nextPartsById.get(p.partId);
        if (!part) continue;
        if ((part.panelImages?.length ?? 0) > 0) continue;

        nextPartsById.set(p.partId, {
          ...part,
          panelImages: [{ imageId: imageAsset.id }],
          updatedAt: now,
        });
      }

      const updatedProject: Project = {
        ...project,
        parts: project.parts.map((p) => nextPartsById.get(p.id) ?? p),
        images: [...project.images, ...imageAssets],
        usage: usageRecord ? [...(project.usage ?? []), usageRecord] : (project.usage ?? []),
        updatedAt: now,
      };

      await window.electronAPI.project.save(updatedProject);
      setProject(updatedProject);
    } catch (err) {
      console.error('Failed to generate images:', err);
      reportError(err instanceof Error ? err.message : '画像生成に失敗しました');
    } finally {
      setIsGeneratingImage(false);
    }
  }, [project, projectId, activePrompts, promptIdsWithAnyImage, reportError, toast]);

  // 画像削除
  const handleDeleteImage = useCallback(
    async (imageId: string) => {
      if (!project) return;

      const image =
        project.images.find((img) => img.id === imageId) ||
        project.article.importedImages.find((img) => img.id === imageId);
      if (!image) return;

      const accepted = await confirm({
        title: '画像を削除しますか？',
        description: 'この画像を削除すると、パートへの割り当ても自動的に解除されます。',
        confirmLabel: '削除',
        confirmVariant: 'danger',
      });
      if (!accepted) return;

      try {
        const result = await window.electronAPI.image.delete(image.filePath);
        if (!result.success) {
          console.warn('Failed to delete image file:', image.filePath);
        }

        const now = new Date().toISOString();

        const updatedParts = project.parts.map((part) => {
          const nextPanelImages = part.panelImages.filter((ref) => ref.imageId !== imageId);
          if (nextPanelImages.length === part.panelImages.length) return part;
          return { ...part, panelImages: nextPanelImages, updatedAt: now };
        });

        const updatedProject: Project = {
          ...project,
          article: {
            ...project.article,
            importedImages: project.article.importedImages.filter((img) => img.id !== imageId),
          },
          parts: updatedParts,
          images: project.images.filter((img) => img.id !== imageId),
          thumbnail: project.thumbnail?.imageId === imageId ? undefined : project.thumbnail,
          updatedAt: now,
        };

        await window.electronAPI.project.save(updatedProject);
        setProject(updatedProject);
        toast.success('画像を削除しました');
      } catch (err) {
        console.error('Failed to delete image:', err);
        reportError(err instanceof Error ? err.message : '画像の削除に失敗しました');
      }
    },
    [confirm, project, reportError, toast]
  );

  // プロンプト更新
  const handleUpdatePrompt = useCallback(
    async (updatedPrompt: ImagePrompt) => {
      if (!project) return;

      const updatedProject = {
        ...project,
        prompts: project.prompts.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p)),
        updatedAt: new Date().toISOString(),
      };

      await window.electronAPI.project.save(updatedProject);
      setProject(updatedProject);
    },
    [project]
  );

  // 選択中のパート
  const selectedPart = project?.parts.find((p) => p.id === selectedPartId);

  const imageById = useMemo(() => {
    const map = new Map<string, Project['images'][number]>();
    if (!project) return map;
    for (const image of [...project.images, ...project.article.importedImages]) {
      map.set(image.id, image);
    }
    return map;
  }, [project]);

  const getImageById = useCallback((imageId: string) => imageById.get(imageId), [imageById]);

  // 選択中のパートのプロンプト
  const selectedPartPrompt = selectedPartId ? latestPromptByPartId.get(selectedPartId) : undefined;

  // 選択中のパートの画像
  const candidateImagesForPart = useMemo(() => {
    if (!project) return [];
    return project.images.filter(
      (img) =>
        img.metadata.promptId &&
        project.prompts.some((p) => p.id === img.metadata.promptId && p.partId === selectedPartId)
    );
  }, [project, selectedPartId]);
  // パートへの割り当て（panelImages）更新
  const handleUpdatePanelImages = useCallback(
    async (partId: string, panelImages: ImageAssetRef[]) => {
      if (!project) return;

      try {
        const now = new Date().toISOString();
        const updatedProject: Project = {
          ...project,
          parts: project.parts.map((p) =>
            p.id === partId ? { ...p, panelImages, updatedAt: now } : p
          ),
          updatedAt: now,
        };

        await window.electronAPI.project.save(updatedProject);
        setProject(updatedProject);
      } catch (err) {
        console.error('Failed to update panel images:', err);
        reportError(err instanceof Error ? err.message : '画像の割り当て更新に失敗しました');
      }
    },
    [project, reportError]
  );

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
      <Header title="画像" subtitle={project.name} />

      {projectId && <WorkflowNav projectId={projectId} current="image" project={project} />}

      {error && (
        <div className="px-4 pt-4">
          <ErrorDetailPanel message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="px-4 pt-3">
        <Card
          title="一括操作"
          subtitle={`画像待ち ${missingImagePromptCount} / 生成済みプロンプト ${activePrompts.length}`}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={handleGeneratePrompts}
                disabled={isGeneratingPrompts}
              >
                {isGeneratingPrompts
                  ? '生成中...'
                  : `プロンプト一括生成 (${activePrompts.length}/${project.parts.length})`}
              </Button>
              <Button
                variant="success"
                onClick={handleGenerateAllImages}
                disabled={
                  isGeneratingImage || activePrompts.length === 0 || missingImagePromptCount === 0
                }
              >
                {isGeneratingImage
                  ? '画像生成中...'
                  : `画像一括生成 (未生成 ${missingImagePromptCount}/${activePrompts.length})`}
              </Button>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">
              {IMAGE_STYLE_PRESET_LABELS[project.presentationProfile.imageStylePreset]}
            </Badge>
            <Badge tone="info">
              {IMAGE_ASPECT_RATIO_LABELS[project.presentationProfile.aspectRatio]}
            </Badge>
          </div>
          <p className="text-xs text-slate-500">
            この画面ではプロンプト作成と画像割り当てだけを扱います。全体進捗は上部の Workflow で確認できます。
          </p>
        </Card>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1.15fr)_minmax(0,1.15fr)] gap-4 overflow-hidden p-4">
        <Card
          title="パート一覧"
          subtitle={`${project.parts.length}パート`}
          className="overflow-hidden"
        >
          <ul className="nv-scrollbar max-h-[calc(100vh-280px)] space-y-2 overflow-auto pr-1">
            {project.parts.map((part, index) => {
              const partPrompt = latestPromptByPartId.get(part.id);
              const assignedCount = part.panelImages.length;
              return (
                <li key={part.id}>
                  <button
                    onClick={() => setSelectedPartId(part.id)}
                    className={`w-full rounded-[8px] border px-3 py-2 text-left transition-colors ${
                      selectedPartId === part.id
                        ? 'border-[var(--nv-color-accent)] bg-blue-50'
                        : 'border-[var(--nv-color-border)] bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{index + 1}</span>
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {part.title}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[11px]">
                      <Badge tone={partPrompt ? 'success' : 'warning'}>
                        {partPrompt ? 'プロンプト済み' : '未プロンプト'}
                      </Badge>
                      <Badge tone={assignedCount > 0 ? 'success' : 'warning'}>
                        {assignedCount}枚
                      </Badge>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          title={selectedPart ? selectedPart.title : 'プロンプト'}
          subtitle={selectedPart?.summary || 'パートを選択してください'}
          className="min-h-0 overflow-auto"
        >
          {selectedPart ? (
            selectedPartPrompt ? (
              <PromptEditor
                key={selectedPartPrompt.id}
                prompt={selectedPartPrompt}
                onSave={handleUpdatePrompt}
                onGenerate={handleGenerateImage}
                onRegenerate={() => handleGeneratePromptForTarget(selectedPart.id)}
                isGenerating={isGeneratingImage}
                isRegenerating={isGeneratingSinglePrompt}
              />
            ) : (
              <EmptyState
                title="このパートのプロンプトがありません"
                description="先にプロンプトを生成すると画像生成できます。"
                action={
                  <Button
                    onClick={() => handleGeneratePromptForTarget(selectedPart.id)}
                    disabled={isGeneratingSinglePrompt}
                  >
                    {isGeneratingSinglePrompt ? '生成中...' : 'プロンプトを生成'}
                  </Button>
                }
              />
            )
          ) : (
            <EmptyState title="パートを選択してください" />
          )}
        </Card>

        <Card
          title="画像割り当て"
          subtitle="候補をクリックで即割り当て（右上アイコンで拡大）"
          className="min-h-0 overflow-auto"
        >
          {selectedPart ? (
            <ImageAssignment
              panelImages={selectedPart.panelImages}
              candidateImages={candidateImagesForPart}
              getImageById={getImageById}
              onChange={(next) => handleUpdatePanelImages(selectedPart.id, next)}
              onDeleteImage={handleDeleteImage}
            />
          ) : (
            <EmptyState title="パートを選択してください" />
          )}
        </Card>
      </div>
    </div>
  );
}
