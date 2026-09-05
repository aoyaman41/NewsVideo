import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ImageAssignment, ImageGallery, PromptEditor } from '../components/image';
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

type ImageBatchErrorLike = {
  index: number;
  partId?: string;
  error: string;
};

function formatImageBatchErrors(errors: ImageBatchErrorLike[], project: Project): string {
  return errors
    .slice(0, 3)
    .map((error) => {
      const part = error.partId ? project.parts.find((item) => item.id === error.partId) : null;
      const label = part ? `パート${part.index + 1}` : `項目${error.index + 1}`;
      return `${label}: ${error.error}`;
    })
    .join(' / ');
}

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
  const [isGeneratingImageBatch, setIsGeneratingImageBatch] = useState(false);

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

  const allProjectImages = useMemo(() => {
    if (!project) return [];
    return [...project.article.importedImages, ...project.images];
  }, [project]);

  const styleReferenceImageIds = project?.presentationProfile.styleReferenceImageIds ?? [];

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
          styleReferenceImageIds: project.presentationProfile.styleReferenceImageIds,
          styleReferenceNote: project.presentationProfile.styleReferenceNote,
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
            styleReferenceImageIds: project.presentationProfile.styleReferenceImageIds,
            styleReferenceNote: project.presentationProfile.styleReferenceNote,
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

        const savedPromptProject: Project = {
          ...project,
          prompts: project.prompts.some((item) => item.id === prompt.id)
            ? project.prompts.map((item) => (item.id === prompt.id ? prompt : item))
            : [...project.prompts, prompt],
          updatedAt: new Date().toISOString(),
        };
        await window.electronAPI.project.save(savedPromptProject);
        setProject(savedPromptProject);

        const promptWithReferences: ImagePrompt = {
          ...prompt,
          styleReferenceImageIds: savedPromptProject.presentationProfile.styleReferenceImageIds,
        };
        const imageAsset = await window.electronAPI.image.generate(promptWithReferences, projectId);
        const usageRecord = createGeminiImageUsageRecordFromAssets([imageAsset], 'image_generate');

        // プロジェクトを更新
        const now = new Date().toISOString();
        const updatedParts = savedPromptProject.parts.map((part) => {
          if (part.id !== prompt.partId) return part;
          // 初回は自動で割り当て（既に割り当てがある場合はユーザーの選択を尊重して変更しない）
          if ((part.panelImages?.length ?? 0) > 0) return part;
          return { ...part, panelImages: [{ imageId: imageAsset.id }], updatedAt: now };
        });

        const updatedProject: Project = {
          ...savedPromptProject,
          parts: updatedParts,
          images: [...savedPromptProject.images, imageAsset],
          usage: usageRecord
            ? [...(savedPromptProject.usage ?? []), usageRecord]
            : (savedPromptProject.usage ?? []),
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

    const targetPrompts = activePrompts
      .filter((prompt) => !promptIdsWithAnyImage.has(prompt.id))
      .map((prompt) => ({
        ...prompt,
        styleReferenceImageIds: project.presentationProfile.styleReferenceImageIds,
      }));

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
      setIsGeneratingImageBatch(true);
      setError(null);

      const batchResult = await window.electronAPI.image.generateBatch(targetPrompts, projectId);
      const imageAssets = batchResult.images;
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
      if (batchResult.errors.length > 0) {
        const head = formatImageBatchErrors(batchResult.errors, updatedProject);
        const tail =
          batchResult.errors.length > 3 ? `（他${batchResult.errors.length - 3}件）` : '';
        reportError(
          `一部の画像生成に失敗しました。成功 ${imageAssets.length}/${batchResult.requestedCount}: ${head}${tail}`,
          '一部失敗しました'
        );
      }
    } catch (err) {
      console.error('Failed to generate images:', err);
      reportError(err instanceof Error ? err.message : '画像生成に失敗しました');
    } finally {
      setIsGeneratingImageBatch(false);
      setIsGeneratingImage(false);
    }
  }, [project, projectId, activePrompts, promptIdsWithAnyImage, reportError, toast]);

  const handleCancelImageBatch = useCallback(async () => {
    if (!projectId) return;

    try {
      await window.electronAPI.image.cancelBatch(projectId);
      toast.info('画像一括生成のキャンセルを要求しました', 'キャンセル中');
    } catch (err) {
      reportError(err instanceof Error ? err.message : '画像生成のキャンセルに失敗しました');
    }
  }, [projectId, reportError, toast]);

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
          presentationProfile: {
            ...project.presentationProfile,
            styleReferenceImageIds: project.presentationProfile.styleReferenceImageIds.filter(
              (id) => id !== imageId
            ),
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

  const handleToggleStyleReference = useCallback(
    async (imageId: string) => {
      if (!project) return;

      const currentIds = project.presentationProfile.styleReferenceImageIds;
      const nextIds = currentIds.includes(imageId)
        ? currentIds.filter((id) => id !== imageId)
        : [...currentIds, imageId].slice(-3);

      const updatedProject: Project = {
        ...project,
        presentationProfile: {
          ...project.presentationProfile,
          styleReferenceImageIds: nextIds,
        },
        updatedAt: new Date().toISOString(),
      };

      await window.electronAPI.project.save(updatedProject);
      setProject(updatedProject);
    },
    [project]
  );

  const handleUpdateStyleReferenceNote = useCallback(
    async (styleReferenceNote: string) => {
      if (!project) return;

      const updatedProject: Project = {
        ...project,
        presentationProfile: {
          ...project.presentationProfile,
          styleReferenceNote,
        },
        updatedAt: new Date().toISOString(),
      };

      await window.electronAPI.project.save(updatedProject);
      setProject(updatedProject);
    },
    [project]
  );

  const handleImportStyleReference = useCallback(async () => {
    if (!project || !projectId) return;

    try {
      const sourcePath = await window.electronAPI.file.selectFile({
        title: 'スタイル参照に使うスライド画像を選択',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        properties: ['openFile'],
      });
      if (!sourcePath) return;

      const imported = await window.electronAPI.image.import(sourcePath, projectId);
      const nextIds = [...project.presentationProfile.styleReferenceImageIds, imported.id].slice(
        -3
      );
      const updatedProject: Project = {
        ...project,
        article: {
          ...project.article,
          importedImages: [...project.article.importedImages, imported],
        },
        presentationProfile: {
          ...project.presentationProfile,
          styleReferenceImageIds: nextIds,
        },
        updatedAt: new Date().toISOString(),
      };

      await window.electronAPI.project.save(updatedProject);
      setProject(updatedProject);
      toast.success('スタイル参照画像を追加しました');
    } catch (err) {
      console.error('Failed to import style reference:', err);
      reportError(err instanceof Error ? err.message : 'スタイル参照画像の追加に失敗しました');
    }
  }, [project, projectId, reportError, toast]);

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
    const generatedForPart = project.images.filter(
      (img) =>
        img.metadata.promptId &&
        project.prompts.some((p) => p.id === img.metadata.promptId && p.partId === selectedPartId)
    );
    return [...project.article.importedImages, ...generatedForPart];
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
              {isGeneratingImageBatch && (
                <Button variant="secondary" onClick={handleCancelImageBatch}>
                  キャンセル
                </Button>
              )}
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
            この画面ではプロンプト作成と画像割り当てだけを扱います。全体進捗は上部の Workflow
            で確認できます。
          </p>
          <div className="mt-4 border-t border-[var(--nv-color-border)] pt-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">スタイル参照</h3>
                <p className="text-xs text-slate-500">
                  最大3枚のスライドサンプルを画像生成時に渡し、色・余白・文字階層を揃えます。
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleImportStyleReference}>
                参照画像を追加
              </Button>
            </div>
            <textarea
              key={project.presentationProfile.styleReferenceNote}
              defaultValue={project.presentationProfile.styleReferenceNote}
              onBlur={(e) => handleUpdateStyleReferenceNote(e.target.value)}
              className="nv-input mb-3 min-h-[72px] resize-y text-sm"
              placeholder="任意: サンプルから特に合わせたい点（例: 太い見出し、左上ロゴ風の余白、青いカード背景など）"
            />
            {allProjectImages.length > 0 ? (
              <ImageGallery
                images={allProjectImages}
                selectedImageIds={styleReferenceImageIds}
                onSelectImage={handleToggleStyleReference}
                selectLabel="参照"
                emptyMessage="参照に使える画像がありません"
              />
            ) : (
              <div className="rounded-[8px] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                参照に使える画像がありません。スライドサンプルを追加してください。
              </div>
            )}
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
