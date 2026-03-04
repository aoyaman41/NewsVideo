import { useEffect, useMemo, useState } from 'react';
import type { ImagePrompt } from '../../schemas';
import { Badge, Button, StatusChip } from '../ui';

interface PromptEditorProps {
  prompt: ImagePrompt;
  onSave: (updatedPrompt: ImagePrompt) => void;
  onGenerate: (prompt: ImagePrompt) => void;
  onRegenerate?: () => void;
  isGenerating?: boolean;
  isRegenerating?: boolean;
}

const FIXED_STYLE_PRESET = 'news_broadcast';

function formatPromptForReadability(value: string): string {
  return value
    .replace(/[、,]\s*/g, '、\n')
    .replace(/。\s*/g, '。\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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

  const promptCharCount = useMemo(() => editedPrompt.trim().length, [editedPrompt]);
  const promptLineCount = useMemo(
    () => (editedPrompt.length === 0 ? 0 : editedPrompt.split(/\r?\n/).length),
    [editedPrompt]
  );
  const negativeCharCount = useMemo(() => editedNegativePrompt.trim().length, [editedNegativePrompt]);

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

  const handleFormat = () => {
    const formatted = formatPromptForReadability(editedPrompt);
    if (formatted.length > 0) {
      setEditedPrompt(formatted);
    }
  };

  return (
    <div className="space-y-4">
      <div className="nv-surface-muted flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={hasChanges ? 'warning' : 'success'} label={hasChanges ? '未保存' : '保存済み'} />
          <Badge tone="neutral">v{prompt.version}</Badge>
          <Badge tone="info">{prompt.aspectRatio}</Badge>
        </div>
        <div className="text-xs text-slate-500">
          {promptLineCount}行 / {promptCharCount}文字
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="block text-sm font-medium text-slate-700">画像プロンプト</label>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={handleFormat}>
              整形
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsAdvancedMode((prev) => !prev)}>
              {isAdvancedMode ? '詳細を閉じる' : '詳細設定'}
            </Button>
          </div>
        </div>

        <textarea
          value={editedPrompt}
          onChange={(e) => setEditedPrompt(e.target.value)}
          className="nv-input min-h-[260px] resize-y font-mono text-[13px] leading-6"
          placeholder="画像生成プロンプト（日本語）"
        />
        <p className="mt-1 text-xs text-slate-500">
          長文は「整形」で改行を入れると読みやすくなります。内容はそのまま保持されます。
        </p>
      </div>

      {isAdvancedMode && (
        <div className="rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-slate-700">
              ネガティブプロンプト（除外したい要素）
            </label>
            <span className="text-xs text-slate-500">{negativeCharCount}文字</span>
          </div>
          <textarea
            value={editedNegativePrompt}
            onChange={(e) => setEditedNegativePrompt(e.target.value)}
            className="nv-input min-h-[110px] resize-y font-mono text-[12px] leading-5"
            placeholder="除外したい要素（日本語）"
          />
        </div>
      )}

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
