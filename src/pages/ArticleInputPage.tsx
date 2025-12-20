import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ArticleInput, FileImport, ImageDropzone } from '../components/article';
import type { ArticleInput as ArticleInputType, ImageAsset, Project } from '../schemas';
import { toLocalFileUrl } from '../utils/toLocalFileUrl';

export function ArticleInputPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [articleData, setArticleData] = useState<Partial<ArticleInputType>>({
    title: '',
    source: '',
    bodyText: '',
  });
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [imageBlobUrls, setImageBlobUrls] = useState<Map<string, string>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetPartCount, setTargetPartCount] = useState<number>(5);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectId) return;
      try {
        const project = await window.electronAPI.project.load(projectId);
        if (cancelled) return;

        setProject(project);
        setArticleData({
          title: project.article?.title ?? '',
          source: project.article?.source ?? '',
          bodyText: project.article?.bodyText ?? '',
        });
        if (project.parts?.length) {
          const nextCount = Math.min(20, Math.max(1, project.parts.length));
          setTargetPartCount(nextCount);
        }

        const imported = (project.article?.importedImages ?? []) as ImageAsset[];
        setImages(imported);
        const map = new Map<string, string>();
        for (const img of imported) {
          map.set(img.id, toLocalFileUrl(img.filePath));
        }
        setImageBlobUrls(map);
      } catch (err) {
        console.error('Failed to load project:', err);
        setError(err instanceof Error ? err.message : 'プロジェクトの読み込みに失敗しました');
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleTextImported = useCallback((title: string, text: string) => {
    setArticleData((prev) => ({
      ...prev,
      title: prev?.title || title,
      bodyText: text,
    }));
  }, []);

  const handleImagesAdded = useCallback((newImages: ImageAsset[], newBlobUrls: Map<string, string>) => {
    setImages((prev) => [...prev, ...newImages]);
    setImageBlobUrls((prev) => {
      const updated = new Map(prev);
      newBlobUrls.forEach((value, key) => updated.set(key, value));
      return updated;
    });
  }, []);

  const handleImageRemoved = useCallback((imageId: string) => {
    const image = images.find((img) => img.id === imageId);
    if (image) {
      window.electronAPI.image.delete(image.filePath).catch((err) => {
        console.warn('Failed to delete imported image file:', err);
      });
    }

    // blob URLを解放
    const blobUrl = imageBlobUrls.get(imageId);
    if (blobUrl && blobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(blobUrl);
    }
    setImages((prev) => prev.filter((img) => img.id !== imageId));
    setImageBlobUrls((prev) => {
      const updated = new Map(prev);
      updated.delete(imageId);
      return updated;
    });
  }, [imageBlobUrls, images]);

  const handleSubmit = async (data: ArticleInputType) => {
    if (!projectId) return;

    setIsGenerating(true);
    setError(null);

    try {
      // 記事データをプロジェクトに保存
      const project = await window.electronAPI.project.load(projectId);
      project.article = {
        title: data.title,
        source: data.source,
        bodyText: data.bodyText,
        importedImages: images,
      };
      project.updatedAt = new Date().toISOString();
      await window.electronAPI.project.save(project);

      // スクリプト生成を実行
      const parts = await window.electronAPI.ai.generateScript(project.article, {
        tone: 'news',
        targetPartCount,
      });

      // 生成されたパートをプロジェクトに保存
      project.parts = parts;
      project.updatedAt = new Date().toISOString();
      await window.electronAPI.project.save(project);

      // スクリプト編集画面に遷移
      navigate(`/projects/${projectId}/script`);
    } catch (err) {
      console.error('Script generation failed:', err);
      setError(err instanceof Error ? err.message : 'スクリプト生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="記事"
        subtitle={project?.name}
      />

      {projectId && <WorkflowNav projectId={projectId} current="article" project={project} />}

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* エラー表示 */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* ファイルインポート */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">ファイルからインポート</h2>
            <FileImport onTextImported={handleTextImported} />
          </div>

          {/* 記事入力フォーム */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">スクリプト生成設定</h2>
            <div className="flex flex-wrap items-center gap-4">
              <label className="text-sm font-medium text-gray-700">パート数</label>
              <input
                type="number"
                min={1}
                max={20}
                value={targetPartCount}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  setTargetPartCount(Math.min(20, Math.max(1, Math.round(next))));
                }}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-sm text-gray-500">1〜20</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              画像を分けたい場合はパートを増やす運用を推奨します（後から編集も可能です）
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">記事情報</h2>
            <ArticleInput
              defaultValues={articleData}
              onSubmit={handleSubmit}
              isLoading={isGenerating}
            />
          </div>

          {/* 画像インポート */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">記事画像（任意）</h2>
            <p className="text-sm text-gray-500 mb-4">
              記事に関連する画像をインポートできます。これらの画像はパネル画像として使用できます。
            </p>
            <ImageDropzone
              images={images}
              projectId={projectId}
              onImagesAdded={handleImagesAdded}
              onImageRemoved={handleImageRemoved}
              blobUrlMap={imageBlobUrls}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
