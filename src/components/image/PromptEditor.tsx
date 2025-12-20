import { useEffect, useMemo, useState } from 'react';
import type { ImagePrompt } from '../../schemas';

interface PromptEditorProps {
  prompt: ImagePrompt;
  onSave: (updatedPrompt: ImagePrompt) => void;
  onGenerate: (prompt: ImagePrompt) => void;
  isGenerating?: boolean;
  onRegeneratePrompt?: () => void;
  isGeneratingPrompt?: boolean;
  onApplyComment?: (comment: string) => void;
  isApplyingComment?: boolean;
}

// スタイルプリセット
const STYLE_PRESETS = [
  { id: 'news_broadcast', label: 'ニュース報道', description: 'プロフェッショナルなニュース映像風' },
  { id: 'documentary', label: 'ドキュメンタリー', description: 'ドキュメンタリー映像風' },
  { id: 'infographic', label: 'インフォグラフィック', description: 'データビジュアライゼーション' },
  { id: 'photorealistic', label: 'フォトリアリスティック', description: '写真のようなリアルな映像' },
  { id: 'illustration', label: 'イラストレーション', description: 'イラスト風の表現' },
];

export function PromptEditor({
  prompt,
  onSave,
  onGenerate,
  isGenerating = false,
  onRegeneratePrompt,
  isGeneratingPrompt = false,
  onApplyComment,
  isApplyingComment = false,
}: PromptEditorProps) {
  const [editedPrompt, setEditedPrompt] = useState(prompt.prompt);
  const [editedNegativePrompt, setEditedNegativePrompt] = useState(prompt.negativePrompt || '');
  const [selectedStylePreset, setSelectedStylePreset] = useState(prompt.stylePreset);
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [comment, setComment] = useState('');

  // パート選択切替時に、前のプロンプト編集状態が残らないよう同期する
  useEffect(() => {
    setEditedPrompt(prompt.prompt);
    setEditedNegativePrompt(prompt.negativePrompt || '');
    setSelectedStylePreset(prompt.stylePreset);
    setShowCommentInput(false);
    setComment('');
  }, [prompt.id, prompt.prompt, prompt.negativePrompt, prompt.stylePreset]);

  const hasChanges = useMemo(() => {
    const baseNegative = prompt.negativePrompt || '';
    return (
      editedPrompt !== prompt.prompt ||
      editedNegativePrompt !== baseNegative ||
      selectedStylePreset !== prompt.stylePreset
    );
  }, [editedNegativePrompt, editedPrompt, prompt.negativePrompt, prompt.prompt, prompt.stylePreset, selectedStylePreset]);

  const handleSave = () => {
    onSave({
      ...prompt,
      prompt: editedPrompt,
      negativePrompt: editedNegativePrompt,
      stylePreset: selectedStylePreset,
      version: prompt.version + 1,
    });
  };

  const handleGenerate = () => {
    const updatedPrompt: ImagePrompt = {
      ...prompt,
      prompt: editedPrompt,
      negativePrompt: editedNegativePrompt,
      stylePreset: selectedStylePreset,
    };
    onGenerate(updatedPrompt);
  };

  const handleApplyComment = () => {
    if (!onApplyComment) return;
    if (!comment.trim()) return;
    onApplyComment(comment.trim());
    setShowCommentInput(false);
    setComment('');
  };

  return (
    <div className="space-y-4">
      {/* スタイルプリセット選択 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          スタイルプリセット
        </label>
        <div className="grid grid-cols-2 gap-2">
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelectedStylePreset(preset.id)}
              className={`p-3 text-left rounded-lg border transition-colors ${
                selectedStylePreset === preset.id
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-medium text-sm">{preset.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{preset.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* プロンプト表示/編集 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            画像プロンプト
          </label>
          <div className="flex items-center gap-3">
            {onRegeneratePrompt && (
              <button
                onClick={onRegeneratePrompt}
                disabled={isGeneratingPrompt}
                className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {isGeneratingPrompt ? '生成中...' : 'このパートだけ再生成'}
              </button>
            )}
            <button
              onClick={() => setIsAdvancedMode(!isAdvancedMode)}
              className="text-sm text-purple-600 hover:text-purple-700"
            >
              {isAdvancedMode ? '詳細を閉じる' : '詳細設定'}
            </button>
          </div>
        </div>

        <textarea
          value={editedPrompt}
          onChange={(e) => setEditedPrompt(e.target.value)}
          className="w-full h-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
          placeholder="画像生成プロンプト（英語）"
        />
      </div>

      {/* ネガティブプロンプト（上級者モードのみ） */}
      {isAdvancedMode && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            ネガティブプロンプト（除外したい要素）
          </label>
          <textarea
            value={editedNegativePrompt}
            onChange={(e) => setEditedNegativePrompt(e.target.value)}
            className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
            placeholder="除外したい要素（英語）"
          />
        </div>
      )}

      {/* コメントでAI修正 */}
      {onApplyComment && (
        <div className="border rounded-lg p-3 bg-amber-50 border-amber-200">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-amber-800">コメントでAI修正</div>
            <button
              onClick={() => setShowCommentInput(!showCommentInput)}
              className="text-xs text-amber-700 hover:text-amber-900"
            >
              {showCommentInput ? '閉じる' : '開く'}
            </button>
          </div>
          {showCommentInput && (
            <>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="例: もう少し具体的に、地図を強調して"
                className="mt-2 w-full px-3 py-2 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setShowCommentInput(false)}
                  className="px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100 rounded-lg"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleApplyComment}
                  disabled={!comment.trim() || isApplyingComment}
                  className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isApplyingComment ? '修正中...' : 'AIで修正'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* アスペクト比 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          アスペクト比
        </label>
        <div className="flex gap-2">
          {[
            { value: '16:9', label: '16:9 (横長)' },
            { value: '1:1', label: '1:1 (正方形)' },
            { value: '9:16', label: '9:16 (縦長)' },
          ].map((option) => (
            <button
              key={option.value}
              disabled
              className={`px-4 py-2 text-sm rounded-lg border ${
                prompt.aspectRatio === option.value
                  ? 'border-purple-500 bg-purple-50 text-purple-700'
                  : 'border-gray-200 text-gray-400'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          アスペクト比はプロジェクト設定で変更できます
        </p>
      </div>

      {/* アクションボタン */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <button
          onClick={handleSave}
          disabled={!hasChanges}
          className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          保存
        </button>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              生成中...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              画像を生成
            </>
          )}
        </button>
      </div>
    </div>
  );
}
