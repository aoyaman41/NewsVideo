import { useState, useEffect, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { partEditSchema, type PartEdit, type Part } from '../../schemas';
import { Button, Card } from '../ui';

interface ScriptEditorProps {
  part: Part;
  /** 入力のたびに呼ぶ(保存は自動) */
  onSave: (partId: string, data: PartEdit) => void;
  onRegenerateWithComment: (partId: string, comment: string) => Promise<void> | void;
  isProcessing?: boolean;
  /** AI で書き直せない理由(自動生成の実行中など) */
  rewriteBlockedReason?: string | null;
  /** 直前の AI による書き直し */
  diffPreview?: { before: string; after: string } | null;
  onUndoRewrite?: () => void;
  onCloseDiff?: () => void;
  onMergeNext?: () => void;
}

export function ScriptEditor({
  part,
  onSave,
  onRegenerateWithComment,
  isProcessing = false,
  rewriteBlockedReason,
  diffPreview,
  onUndoRewrite,
  onCloseDiff,
  onMergeNext,
}: ScriptEditorProps) {
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [comment, setComment] = useState('');
  const prevPartIdRef = useRef<string | null>(null);

  const {
    register,
    formState: { errors },
    reset,
    control,
    getValues,
  } = useForm<PartEdit>({
    resolver: zodResolver(partEditSchema),
    mode: 'onChange',
    defaultValues: {
      title: part.title,
      summary: part.summary,
      scriptText: part.scriptText,
    },
  });

  useEffect(() => {
    const current = getValues();
    const isNewPart = prevPartIdRef.current !== part.id;
    const isExternalUpdate =
      part.title !== current.title ||
      part.summary !== (current.summary ?? '') ||
      part.scriptText !== current.scriptText;

    if (isNewPart || isExternalUpdate) {
      reset({
        title: part.title,
        summary: part.summary,
        scriptText: part.scriptText,
      });
    }
    prevPartIdRef.current = part.id;
  }, [part.id, part.title, part.summary, part.scriptText, reset, getValues]);

  const handleRegenerate = async () => {
    const text = comment.trim();
    if (!text) return;
    await onRegenerateWithComment(part.id, text);
    setShowCommentInput(false);
    setComment('');
  };

  const watchedScript = useWatch({ control, name: 'scriptText' }) ?? '';
  const charCount = watchedScript.length;
  const estimatedSeconds = Math.round(charCount / 4);

  return (
    <Card emphasis title={`シーン ${part.index + 1}`}>
      <form
        className="space-y-4"
        onSubmit={(event) => event.preventDefault()}
        onChange={() => onSave(part.id, getValues())}
      >
        <div>
          <label htmlFor="scene-title" className="nv-label">
            見出し
          </label>
          <input
            id="scene-title"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? 'scene-title-error' : undefined}
            type="text"
            {...register('title')}
            className="nv-input text-base font-semibold"
          />
          {errors.title && (
            <p id="scene-title-error" className="mt-1 text-xs text-[var(--nv-color-danger)]">
              {errors.title.type === 'too_big'
                ? '見出しは 100 文字以内にしてください。'
                : '見出しを入れてください。'}
            </p>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="scene-script" className="nv-label mb-0">
              台本（読み上げる文章）
            </label>
            <span className="text-xs text-[var(--nv-color-muted)] tabular-nums">
              {charCount} 文字・約 {estimatedSeconds} 秒
            </span>
          </div>
          <textarea
            id="scene-script"
            aria-invalid={!!errors.scriptText}
            aria-describedby={errors.scriptText ? 'scene-script-error' : undefined}
            {...register('scriptText')}
            readOnly={isProcessing}
            rows={10}
            className="nv-input resize-y text-[15px] leading-7"
          />
          {errors.scriptText && (
            <p id="scene-script-error" className="mt-1 text-xs text-[var(--nv-color-danger)]">
              {errors.scriptText.type === 'too_big'
                ? '台本は 5000 文字以内にしてください。'
                : '台本を入れてください。空のままでは音声を作れません。'}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="scene-summary" className="nv-label">
            要約（任意。シーンの一覧に表示します）
          </label>
          <textarea
            id="scene-summary"
            {...register('summary')}
            rows={2}
            className="nv-input resize-y text-sm"
          />
        </div>
      </form>

      <div className="mt-4 space-y-3 border-t border-[var(--nv-color-border)] pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowCommentInput((prev) => !prev)}
            disabled={isProcessing || Boolean(rewriteBlockedReason)}
            aria-expanded={showCommentInput}
          >
            {isProcessing ? '書き直しています…' : 'AI に書き直してもらう'}
          </Button>
          {onMergeNext && (
            <Button variant="ghost" onClick={onMergeNext} disabled={isProcessing}>
              次のシーンとまとめる
            </Button>
          )}
        </div>
        {rewriteBlockedReason && <p className="nv-help">{rewriteBlockedReason}</p>}

        {showCommentInput && (
          <div className="nv-surface-muted space-y-2 p-3">
            <label className="block">
              <span className="nv-label">どう直したいかを書いてください</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="例: 結論を先に、もっと短く、専門用語を言いかえて"
                className="nv-input resize-y text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCommentInput(false)}>
                やめる
              </Button>
              <Button
                size="sm"
                onClick={() => void handleRegenerate()}
                disabled={!comment.trim() || isProcessing}
              >
                {isProcessing ? '書き直しています…' : '書き直す'}
              </Button>
            </div>
          </div>
        )}

        {diffPreview && (
          <div className="space-y-2" role="status">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--nv-color-text)]">
                AI が書き直しました
              </p>
              <div className="flex gap-2">
                {onUndoRewrite && (
                  <Button size="sm" variant="secondary" onClick={onUndoRewrite}>
                    元に戻す
                  </Button>
                )}
                {onCloseDiff && (
                  <Button size="sm" variant="ghost" onClick={onCloseDiff}>
                    閉じる
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-2 @2xl:grid-cols-2">
              <div className="nv-surface-muted p-3 text-sm">
                <div className="nv-label">変更前</div>
                <div className="max-h-40 overflow-auto whitespace-pre-wrap text-[var(--nv-color-muted)]">
                  {diffPreview.before}
                </div>
              </div>
              <div className="rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-success)]/30 bg-[var(--nv-color-success)]/5 p-3 text-sm">
                <div className="nv-label">変更後</div>
                <div className="max-h-40 overflow-auto whitespace-pre-wrap text-[var(--nv-color-text)]">
                  {diffPreview.after}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
