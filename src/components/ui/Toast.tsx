import { StatusChip } from './StatusChip';
import type { Tone } from '../../types/ui';

const toneLabels: Record<Tone, string> = {
  info: '案内',
  success: '完了',
  warning: '注意',
  danger: 'エラー',
  neutral: '通知',
};

export function Toast({
  tone,
  title,
  message,
  onDismiss,
}: {
  tone: Tone;
  title?: string;
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="nv-surface flex items-start gap-3 px-4 py-3 shadow-[var(--nv-shadow-md)]">
      <StatusChip tone={tone} label={toneLabels[tone]} className="shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <div className="text-sm font-semibold text-slate-900">{title}</div>}
        <div className="text-sm text-slate-700">{message}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          className="rounded-[8px] px-2 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          onClick={onDismiss}
          aria-label="閉じる"
        >
          ×
        </button>
      )}
    </div>
  );
}
