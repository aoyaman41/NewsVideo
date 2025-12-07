import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/layout';
import { ArticleInput, FileImport, ImageDropzone } from '../components/article';
import type { ArticleInput as ArticleInputType, ImageAsset } from '../schemas';

export function ArticleInputPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [articleData, setArticleData] = useState<Partial<ArticleInputType>>({
    title: '',
    source: '',
    bodyText: '',
  });
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [imageBlobUrls, setImageBlobUrls] = useState<Map<string, string>>(new Map());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // blob URLを解放
    const blobUrl = imageBlobUrls.get(imageId);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    setImages((prev) => prev.filter((img) => img.id !== imageId));
    setImageBlobUrls((prev) => {
      const updated = new Map(prev);
      updated.delete(imageId);
      return updated;
    });
  }, [imageBlobUrls]);

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
        title="記事入力"
        subtitle="スクリプト生成のための記事を入力"
        actions={
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        }
      />

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
