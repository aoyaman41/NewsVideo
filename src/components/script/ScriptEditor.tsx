import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { partEditSchema, type PartEdit, type Part } from '../../schemas';

interface ScriptEditorProps {
  part: Part;
  onSave: (partId: string, data: PartEdit) => void;
  onRegenerateWithComment: (partId: string, comment: string) => void;
  isProcessing?: boolean;
}

export function ScriptEditor({
  part,
  onSave,
  onRegenerateWithComment,
  isProcessing,
}: ScriptEditorProps) {
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [comment, setComment] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<PartEdit>({
    resolver: zodResolver(partEditSchema),
    defaultValues: {
      title: part.title,
      scriptText: part.scriptText,
    },
  });

  // パートが変わったらフォームをリセット
  useEffect(() => {
    reset({
      title: part.title,
      scriptText: part.scriptText,
    });
    setShowCommentInput(false);
    setComment('');
  }, [part.id, part.title, part.scriptText, reset]);

  const onSubmit = (data: PartEdit) => {
    onSave(part.id, data);
  };

  const handleRegenerate = () => {
    if (comment.trim()) {
      onRegenerateWithComment(part.id, comment);
      setShowCommentInput(false);
      setComment('');
    }
  };

  const estimateCharCount = (text: string) => text.length;
  const estimateDuration = (text: string) => Math.round(text.length / 4); // 4文字/秒

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">スクリプト編集</h3>
            <p className="text-sm text-gray-500">パート {part.index + 1}</p>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
                未保存の変更があります
              </span>
            )}
            <button
              onClick={() => setShowCommentInput(!showCommentInput)}
              disabled={isProcessing}
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              コメントで修正
            </button>
            <button
              onClick={handleSubmit(onSubmit)}
              disabled={!isDirty || isProcessing}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>

      {/* コメント入力エリア */}
      {showCommentInput && (
        <div className="p-4 bg-yellow-50 border-b border-yellow-200">
          <label className="block text-sm font-medium text-yellow-800 mb-2">
            修正コメント
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="例: もっと簡潔に、具体的な数字を入れて"
            className="w-full px-3 py-2 border border-yellow-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setShowCommentInput(false)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-yellow-100 rounded-lg transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleRegenerate}
              disabled={!comment.trim() || isProcessing}
              className="px-3 py-1.5 text-sm bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isProcessing ? 'AIで修正中...' : 'AIで修正'}
            </button>
          </div>
        </div>
      )}

      {/* 編集フォーム */}
      <form className="flex-1 overflow-auto p-4 space-y-4">
        {/* タイトル */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            パートタイトル
          </label>
          <input
            type="text"
            {...register('title')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.title && (
            <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
          )}
        </div>

        {/* スクリプト */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">
              ナレーションスクリプト
            </label>
            <span className="text-xs text-gray-500">
              {estimateCharCount(part.scriptText)}文字 / 約{estimateDuration(part.scriptText)}秒
            </span>
          </div>
          <textarea
            {...register('scriptText')}
            rows={15}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y font-mono text-sm"
          />
          {errors.scriptText && (
            <p className="mt-1 text-sm text-red-600">{errors.scriptText.message}</p>
          )}
        </div>

        {/* メタ情報 */}
        <div className="text-xs text-gray-400 space-y-1">
          <p>生成日時: {new Date(part.scriptGeneratedAt).toLocaleString('ja-JP')}</p>
          <p>更新日時: {new Date(part.updatedAt).toLocaleString('ja-JP')}</p>
        </div>
      </form>
    </div>
  );
}
