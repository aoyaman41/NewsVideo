import { StatusChip } from './StatusChip';
import type { Tone } from '../../types/ui';

export function Toast({ tone, message }: { tone: Tone; message: string }) {
  return (
    <div className="nv-surface flex items-center justify-between gap-3 px-3 py-2">
      <StatusChip tone={tone} label={tone.toUpperCase()} />
      <span className="text-sm text-slate-700">{message}</span>
    </div>
  );
}
