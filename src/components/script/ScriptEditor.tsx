import { useState, useEffect, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { partEditSchema, type PartEdit, type Part } from '../../schemas';
import { Badge, Button, Card, StatusChip } from '../ui';

interface AutoSaveStatus {
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: Date | null;
}

interface ScriptEditorProps {
  part: Part;
  onSave: (partId: string, data: PartEdit) => void;
  onRegenerateWithComment: (partId: string, comment: string) => void;
  isProcessing?: boolean;
  lastCommentAppliedAt?: string | null;
  autoSaveStatus?: AutoSaveStatus;
  autoSaveDelayMs?: number;
  diffPreview?: { before: string; after: string } | null;
}

export function ScriptEditor({
  part,
  onSave,
  onRegenerateWithComment,
  isProcessing,
  lastCommentAppliedAt,
  autoSaveStatus,
  autoSaveDelayMs = 1500,
  diffPreview,
}: ScriptEditorProps) {
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [comment, setComment] = useState('');
  const [showAppliedPulse, setShowAppliedPulse] = useState(false);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevPartIdRef = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    control,
    getValues,
  } = useForm<PartEdit>({
    resolver: zodResolver(partEditSchema),
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

  useEffect(() => {
    if (!lastCommentAppliedAt) return;
    const showTimer = window.setTimeout(() => setShowAppliedPulse(true), 0);
    const hideTimer = window.setTimeout(() => setShowAppliedPulse(false), 1600);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [lastCommentAppliedAt]);

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

  const estimateCharCount = (text?: string) => text?.length ?? 0;
  const estimateDuration = (text?: string) => Math.round((text?.length ?? 0) / 4);

  const [watchedTitle = '', watchedSummary = '', watchedScript = ''] = useWatch({
    control,
    name: ['title', 'summary', 'scriptText'],
  });

  useEffect(() => {
    if (!isDirty || isProcessing) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      onSave(part.id, { title: watchedTitle, summary: watchedSummary, scriptText: watchedScript });
      reset({ title: watchedTitle, summary: watchedSummary, scriptText: watchedScript });
    }, autoSaveDelayMs);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [
    autoSaveDelayMs,
    isDirty,
    isProcessing,
    onSave,
    part.id,
    reset,
    watchedTitle,
    watchedSummary,
    watchedScript,
  ]);

  const saveStatusLabel = useMemo(() => {
    if (!autoSaveStatus) return null;
    if (autoSaveStatus.isSaving) return { tone: 'info', label: '自動保存中...' } as const;
    if (autoSaveStatus.isDirty) return { tone: 'warning', label: '未保存' } as const;
    if (autoSaveStatus.lastSavedAt) return { tone: 'success', label: '保存済み' } as const;
    return null;
  }, [autoSaveStatus]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <Card
        title={`パート ${part.index + 1} 編集`}
        subtitle="タイトル・要約・原稿を編集"
        actions={
          <div className="flex items-center gap-2">
            {isDirty && <Badge tone="warning">未保存の変更</Badge>}
            {saveStatusLabel && (
              <StatusChip tone={saveStatusLabel.tone} label={saveStatusLabel.label} />
            )}
            {showAppliedPulse && <Badge tone="success">修正完了</Badge>}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCommentInput((prev) => !prev)}
              disabled={isProcessing}
            >
              コメント修正
            </Button>
            <Button size="sm" onClick={handleSubmit(onSubmit)} disabled={!isDirty || isProcessing}>
              保存
            </Button>
          </div>
        }
      >
        <form className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              パートタイトル
            </label>
            <input type="text" {...register('title')} className="nv-input" />
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">要約</label>
            <textarea {...register('summary')} rows={2} className="nv-input resize-y" />
            {errors.summary && (
              <p className="mt-1 text-xs text-red-600">{errors.summary.message}</p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">ナレーション原稿</label>
              <span className="text-xs text-slate-500">
                {estimateCharCount(watchedScript)}文字 / 約{estimateDuration(watchedScript)}秒
              </span>
            </div>
            <textarea
              {...register('scriptText')}
              rows={12}
              className="nv-input resize-y font-mono text-sm"
            />
            {errors.scriptText && (
              <p className="mt-1 text-xs text-red-600">{errors.scriptText.message}</p>
            )}
          </div>
        </form>
      </Card>

      {showCommentInput && (
        <Card title="コメントで再生成" subtitle="改善点を短く指定してAIで書き直し">
          <div className="space-y-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="例: 結論を先頭に、冗長表現を削ってください"
              className="nv-input resize-y"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowCommentInput(false)}>
                キャンセル
              </Button>
              <Button
                size="sm"
                onClick={handleRegenerate}
                disabled={!comment.trim() || isProcessing}
              >
                {isProcessing ? '修正中...' : 'AIで修正'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {diffPreview && (
        <Card title="再生成差分" subtitle="直近のAI修正（前後比較）" className="min-h-0">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="min-h-24 rounded-[8px] border border-[var(--nv-color-border)] bg-slate-50 p-2 text-xs text-slate-700">
              <div className="mb-1 font-semibold text-slate-500">Before</div>
              <div className="max-h-40 overflow-auto whitespace-pre-wrap">{diffPreview.before}</div>
            </div>
            <div className="min-h-24 rounded-[8px] border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
              <div className="mb-1 font-semibold text-emerald-700">After</div>
              <div className="max-h-40 overflow-auto whitespace-pre-wrap">{diffPreview.after}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="px-1 text-[11px] text-slate-400">
        生成日時: {new Date(part.scriptGeneratedAt).toLocaleString('ja-JP')} / 更新日時:{' '}
        {new Date(part.updatedAt).toLocaleString('ja-JP')}
      </div>
    </div>
  );
}
