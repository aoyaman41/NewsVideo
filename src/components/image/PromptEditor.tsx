import { useEffect, useMemo, useState } from 'react';
import type { ImagePrompt } from '../../schemas';
import { Button } from '../ui';

interface PromptEditorProps {
  prompt: ImagePrompt;
  onSave: (updatedPrompt: ImagePrompt) => void;
  onGenerate: (prompt: ImagePrompt) => void;
  onRegenerate?: () => void;
  isGenerating?: boolean;
  isRegenerating?: boolean;
}

const FIXED_STYLE_PRESET = 'news_broadcast';

export function PromptEditor({
  prompt,
  onSave,
  onGenerate,
  onRegenerate,
  isGenerating = false,
  isRegenerating = false,
}: PromptEditorProps) {
  const [editedPrompt, setEditedPrompt] = useState(prompt.prompt);
  const [editedNegativePrompt, setEditedNegativePrompt] = useState(prompt.negativePrompt || '');
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);

  useEffect(() => {
    setEditedPrompt(prompt.prompt);
    setEditedNegativePrompt(prompt.negativePrompt || '');
  }, [prompt.id, prompt.prompt, prompt.negativePrompt, prompt.stylePreset]);

  const hasChanges = useMemo(() => {
    const baseNegative = prompt.negativePrompt || '';
    return editedPrompt !== prompt.prompt || editedNegativePrompt !== baseNegative;
  }, [editedNegativePrompt, editedPrompt, prompt.negativePrompt, prompt.prompt]);

  const handleSave = () => {
    onSave({
      ...prompt,
      prompt: editedPrompt,
      negativePrompt: editedNegativePrompt,
      stylePreset: FIXED_STYLE_PRESET,
      version: prompt.version + 1,
    });
  };

  const handleGenerate = () => {
    const updatedPrompt: ImagePrompt = {
      ...prompt,
      prompt: editedPrompt,
      negativePrompt: editedNegativePrompt,
      stylePreset: FIXED_STYLE_PRESET,
    };
    onGenerate(updatedPrompt);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-sm font-medium text-slate-700">画像プロンプト</label>
          <button
            onClick={() => setIsAdvancedMode(!isAdvancedMode)}
            className="text-sm text-[var(--nv-color-accent)] hover:text-[#114f88]"
          >
            {isAdvancedMode ? '詳細を閉じる' : '詳細設定'}
          </button>
        </div>

        <textarea
          value={editedPrompt}
          onChange={(e) => setEditedPrompt(e.target.value)}
          className="nv-input h-32 resize-none"
          placeholder="画像生成プロンプト（日本語）"
        />
      </div>

      {isAdvancedMode && (
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">
            ネガティブプロンプト（除外したい要素）
          </label>
          <textarea
            value={editedNegativePrompt}
            onChange={(e) => setEditedNegativePrompt(e.target.value)}
            className="nv-input h-20 resize-none"
            placeholder="除外したい要素（日本語）"
          />
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">アスペクト比</label>
        <div className="flex gap-2">
          {[
            { value: '16:9', label: '16:9 (横長)' },
            { value: '1:1', label: '1:1 (正方形)' },
            { value: '9:16', label: '9:16 (縦長)' },
          ].map((option) => (
            <button
              key={option.value}
              disabled
              className={`rounded-[8px] border px-4 py-2 text-sm ${
                prompt.aspectRatio === option.value
                  ? 'border-[var(--nv-color-accent)] bg-blue-50 text-blue-700'
                  : 'border-[var(--nv-color-border)] text-slate-400'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">アスペクト比はプロジェクト設定で変更できます</p>
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--nv-color-border)] pt-4">
        {onRegenerate && (
          <Button variant="secondary" onClick={onRegenerate} disabled={isRegenerating}>
            {isRegenerating ? '再生成中...' : 'プロンプト再生成'}
          </Button>
        )}
        <Button variant="secondary" onClick={handleSave} disabled={!hasChanges}>
          保存
        </Button>
        <Button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? '生成中...' : '画像を生成'}
        </Button>
      </div>
    </div>
  );
}
