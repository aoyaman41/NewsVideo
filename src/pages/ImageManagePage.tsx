import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ImageAssignment, PromptEditor } from '../components/image';
import { Badge, Button, Card, EmptyState, StatusChip } from '../components/ui';
import type { Project, ImageAssetRef, ImagePrompt } from '../schemas';
import { summarizeProjectProgress } from '../utils/projectHealth';
import { createGeminiImageUsageRecord, createOpenAIUsageRecord } from '../utils/usage';
import { DEFAULT_IMAGE_MODEL } from '../../shared/constants/models';

async function getImageModelFromSettings(): Promise<string> {
  try {
    const settings = await window.electronAPI.settings.get();
    return settings.imageModel || DEFAULT_IMAGE_MODEL;
  } catch {
    return DEFAULT_IMAGE_MODEL;
  }
}

export function ImageManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [isGeneratingSinglePrompt, setIsGeneratingSinglePrompt] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

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
        setError(err instanceof Error ? err.message : 'プロジェクトの読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    loadProject();
  }, [projectId]);

  // 画像プロンプト生成
  const handleGeneratePrompts = useCallback(async () => {
    if (!project || project.parts.length === 0) return;

    try {
      setIsGeneratingPrompts(true);
      setError(null);

      const result = await window.electronAPI.ai.generateImagePrompts(
        project.parts,
        project.article
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
      setError(err instanceof Error ? err.message : 'プロンプト生成に失敗しました');
    } finally {
      setIsGeneratingPrompts(false);
    }
  }, [project]);

  const handleGeneratePromptForTarget = useCallback(
    async (targetId: string) => {
      if (!project) return;

      try {
        setIsGeneratingSinglePrompt(true);
        setError(null);

        const result = await window.electronAPI.ai.generateImagePromptForTarget(
          project.parts,
          project.article,
          targetId
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
        setError(err instanceof Error ? err.message : 'プロンプト生成に失敗しました');
      } finally {
        setIsGeneratingSinglePrompt(false);
      }
    },
    [project]
  );

  // 画像生成
  const handleGenerateImage = useCallback(
    async (prompt: ImagePrompt) => {
      if (!project || !projectId) return;

      try {
        setIsGeneratingImage(true);
        setError(null);

        const imageAsset = await window.electronAPI.image.generate(prompt, projectId);
        const imageModel = await getImageModelFromSettings();
        const usageRecord = createGeminiImageUsageRecord(1, 'image_generate', imageModel);

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
        setError(err instanceof Error ? err.message : '画像生成に失敗しました');
      } finally {
        setIsGeneratingImage(false);
      }
    },
    [project, projectId]
  );

  // 全パートの画像を一括生成
  const handleGenerateAllImages = useCallback(async () => {
    if (!project || !projectId) return;

    const targetPrompts = activePrompts.filter((prompt) => !promptIdsWithAnyImage.has(prompt.id));

    if (targetPrompts.length === 0) {
      setError('未生成の画像がありません（必要なら各パートで個別に生成してください）');
      return;
    }

    try {
      setIsGeneratingImage(true);
      setError(null);

      const imageAssets = await window.electronAPI.image.generateBatch(targetPrompts, projectId);
      const imageModel = await getImageModelFromSettings();
      const usageRecord = createGeminiImageUsageRecord(
        imageAssets.length,
        'image_generate_batch',
        imageModel
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
      setError(err instanceof Error ? err.message : '画像生成に失敗しました');
    } finally {
      setIsGeneratingImage(false);
    }
  }, [project, projectId, activePrompts, promptIdsWithAnyImage]);

  // 画像削除
  const handleDeleteImage = useCallback(
    async (imageId: string) => {
      if (!project) return;

      const image =
        project.images.find((img) => img.id === imageId) ||
        project.article.importedImages.find((img) => img.id === imageId);
      if (!image) return;

      if (!confirm('この画像を削除しますか？\n※割り当てからも自動的に解除されます')) return;

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
      } catch (err) {
        console.error('Failed to delete image:', err);
        setError(err instanceof Error ? err.message : '画像の削除に失敗しました');
      }
    },
    [project]
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
  const summary = useMemo(() => (project ? summarizeProjectProgress(project) : null), [project]);

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
        setError(err instanceof Error ? err.message : '画像の割り当て更新に失敗しました');
      }
    },
    [project]
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
        <div className="text-center">
          <p className="mb-4 text-red-600">プロジェクトが見つかりません</p>
          <Button onClick={() => navigate('/')}>プロジェクト一覧に戻る</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header
        title="画像"
        subtitle={project.name}
        statusLabel={summary ? `未割当 ${summary.missingImages}` : undefined}
        statusTone={summary && summary.missingImages > 0 ? 'warning' : 'success'}
      />

      {projectId && <WorkflowNav projectId={projectId} current="image" project={project} />}

      {error && (
        <div className="mx-4 mt-4 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="px-4 pt-3">
        <Card
          title="一括操作"
          subtitle={`プロンプト ${activePrompts.length}/${project.parts.length} / 未生成画像 ${missingImagePromptCount}`}
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
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Badge tone="warning">未画像 {summary?.missingImages ?? 0}</Badge>
            <Badge tone="warning">未音声 {summary?.missingAudio ?? 0}</Badge>
            <StatusChip tone="info" label={`総パート ${project.parts.length}`} />
          </div>
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
                      <Badge tone={partPrompt ? 'success' : 'neutral'}>
                        {partPrompt ? 'Prompt' : 'No Prompt'}
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
