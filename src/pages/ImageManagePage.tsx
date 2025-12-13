import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/layout';
import { ImageAssignment, ImageGallery, PromptEditor } from '../components/image';
import type { Project, ImageAssetRef, ImagePrompt } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';

export function ImageManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'parts' | 'imported' | 'thumbnail'>('parts');

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
    return project.parts
      .map((part) => latestPromptByPartId.get(part.id))
      .filter((prompt): prompt is ImagePrompt => !!prompt);
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

      const prompts = await window.electronAPI.ai.generateImagePrompts(
        project.parts,
        'news_broadcast'
      );

      // プロジェクトを更新
      const updatedProject = {
        ...project,
        prompts: [...project.prompts, ...prompts],
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

  // 画像生成
  const handleGenerateImage = useCallback(
    async (prompt: ImagePrompt) => {
      if (!project || !projectId) return;

      try {
        setIsGeneratingImage(true);
        setError(null);

        const imageAsset = await window.electronAPI.image.generate(prompt, projectId);

        // プロジェクトを更新
        const updatedProject = {
          ...project,
          images: [...project.images, imageAsset],
          updatedAt: new Date().toISOString(),
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

    const targetPrompts = activePrompts.filter(
      (prompt) => !promptIdsWithAnyImage.has(prompt.id)
    );

    if (targetPrompts.length === 0) {
      setError('未生成の画像がありません（必要なら各パートで個別に生成してください）');
      return;
    }

    try {
      setIsGeneratingImage(true);
      setError(null);

      const imageAssets = await window.electronAPI.image.generateBatch(targetPrompts, projectId);

      // プロジェクトを更新
      const updatedProject = {
        ...project,
        images: [...project.images, ...imageAssets],
        updatedAt: new Date().toISOString(),
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

      if (!confirm('この画像を削除しますか？\n※割り当て/サムネイルからも自動的に解除されます')) return;

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
          thumbnail:
            project.thumbnail?.imageId === imageId ? undefined : project.thumbnail,
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
        prompts: project.prompts.map((p) =>
          p.id === updatedPrompt.id ? updatedPrompt : p
        ),
        updatedAt: new Date().toISOString(),
      };

      await window.electronAPI.project.save(updatedProject);
      setProject(updatedProject);
    },
    [project]
  );

  // サムネイル選択
  const handleSelectThumbnail = useCallback(
    async (imageId: string) => {
      if (!project) return;

      const updatedProject = {
        ...project,
        thumbnail: { imageId },
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

  const getImageById = useCallback(
    (imageId: string) => imageById.get(imageId),
    [imageById]
  );

  // 選択中のパートのプロンプト
  const selectedPartPrompt = selectedPartId
    ? latestPromptByPartId.get(selectedPartId)
    : undefined;

  // 選択中のパートの画像
  const selectedPartImages = project?.images.filter(
    (img) => img.metadata.promptId && project.prompts.find(
      (p) => p.id === img.metadata.promptId && p.partId === selectedPartId
    )
  ) || [];

  // インポート画像
  const importedImages = project?.article.importedImages || [];

  const candidateImagesForPart = useMemo(() => {
    return [...selectedPartImages, ...importedImages];
  }, [importedImages, selectedPartImages]);

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
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">プロジェクトが見つかりません</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            プロジェクト一覧に戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="画像管理"
        subtitle={project.name}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/projects/${projectId}/script`)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              スクリプト編集に戻る
            </button>
            <button
              onClick={() => navigate(`/projects/${projectId}/audio`)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              音声生成へ
            </button>
          </div>
        }
      />

      {/* エラー表示 */}
      {error && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 左サイドバー: パートリスト */}
        <div className="w-64 border-r border-gray-200 overflow-auto bg-gray-50">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-4">パート一覧</h3>
            <ul className="space-y-2">
              {project.parts.map((part, index) => {
                const partPrompt = latestPromptByPartId.get(part.id);
                const assignedCount = part.panelImages.length;

                return (
                  <li key={part.id}>
                    <button
                      onClick={() => setSelectedPartId(part.id)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedPartId === part.id
                          ? 'bg-white shadow border border-blue-200'
                          : 'hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-400">
                          {index + 1}
                        </span>
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {part.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs ${partPrompt ? 'text-green-600' : 'text-gray-400'}`}>
                          {partPrompt ? 'プロンプト有' : 'プロンプト無'}
                        </span>
                        <span className="text-xs text-gray-400">|</span>
                        <span className={`text-xs ${assignedCount > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                          使用 {assignedCount}枚
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* プロンプト一括生成ボタン */}
            <button
              onClick={handleGeneratePrompts}
              disabled={isGeneratingPrompts}
              className="w-full mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isGeneratingPrompts ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  生成中...
                </>
              ) : (
                `プロンプト生成 (${activePrompts.length}/${project.parts.length}件)`
              )}
            </button>

            {/* 画像一括生成ボタン */}
            {activePrompts.length > 0 && (
              <button
                onClick={handleGenerateAllImages}
                disabled={isGeneratingImage || missingImagePromptCount === 0}
                className="w-full mt-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isGeneratingImage ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    生成中...
                  </>
                ) : (
                  `画像一括生成 (未生成 ${missingImagePromptCount}/${activePrompts.length}枚)`
                )}
              </button>
            )}
          </div>
        </div>

        {/* メインコンテンツ */}
        <div className="flex-1 overflow-auto p-6">
          {/* タブ */}
          <div className="flex gap-4 border-b border-gray-200 mb-6">
            <button
              onClick={() => setSelectedTab('parts')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                selectedTab === 'parts'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              パート画像
            </button>
            <button
              onClick={() => setSelectedTab('imported')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                selectedTab === 'imported'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              インポート画像 ({importedImages.length})
            </button>
            <button
              onClick={() => setSelectedTab('thumbnail')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                selectedTab === 'thumbnail'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              サムネイル
            </button>
          </div>

          {/* パート画像タブ */}
          {selectedTab === 'parts' && selectedPart && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {selectedPart.title}
                </h3>
                <p className="text-sm text-gray-500 mb-4">{selectedPart.summary}</p>

                {/* プロンプトエディタ */}
                {selectedPartPrompt ? (
                  <PromptEditor
                    prompt={selectedPartPrompt}
                    onSave={handleUpdatePrompt}
                    onGenerate={handleGenerateImage}
                    isGenerating={isGeneratingImage}
                  />
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>このパートのプロンプトはまだ生成されていません</p>
                    <button
                      onClick={handleGeneratePrompts}
                      disabled={isGeneratingPrompts}
                      className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                    >
                      プロンプトを生成
                    </button>
                  </div>
                )}
              </div>

              {/* 画像割り当て */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <ImageAssignment
                  panelImages={selectedPart.panelImages}
                  candidateImages={candidateImagesForPart}
                  getImageById={getImageById}
                  onChange={(next) => handleUpdatePanelImages(selectedPart.id, next)}
                  onDeleteImage={handleDeleteImage}
                />
              </div>
            </div>
          )}

          {/* インポート画像タブ */}
          {selectedTab === 'imported' && (
            <ImageGallery
              images={importedImages}
              title="インポートした画像"
              onDeleteImage={handleDeleteImage}
              emptyMessage="インポートした画像はありません"
            />
          )}

          {/* サムネイルタブ */}
          {selectedTab === 'thumbnail' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  サムネイル選択
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  動画のサムネイルとして使用する画像を選択してください
                </p>

                {(() => {
                  const allImages = [...project.images, ...importedImages];
                  const currentThumbnail = project.thumbnail?.imageId
                    ? allImages.find((img) => img.id === project.thumbnail?.imageId)
                    : undefined;

                  return (
                    <>
                      {/* 現在のサムネイル */}
                      {project.thumbnail && (
                        <div className="mb-6">
                          <h4 className="text-sm font-medium text-gray-700 mb-2">現在のサムネイル</h4>
                          <div className="w-64">
                            {currentThumbnail && (
                              <img
                                src={toLocalFileUrl(currentThumbnail.filePath)}
                                alt="サムネイル"
                                className="w-full rounded-lg border border-blue-500"
                              />
                            )}
                            {!currentThumbnail && (
                              <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">
                                サムネイル画像が見つかりません
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 全画像から選択 */}
                      <ImageGallery
                        images={allImages}
                        selectedImageIds={project.thumbnail ? [project.thumbnail.imageId] : []}
                        onSelectImage={handleSelectThumbnail}
                        title="画像を選択"
                        emptyMessage="画像がありません。先に画像を生成/インポートしてください。"
                      />
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
