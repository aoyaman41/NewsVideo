import { StatusChip } from '../ui';
import type { Tone } from '../../types/ui';
import { SaveIndicator } from './SaveIndicator';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  statusLabel?: string;
  statusTone?: Tone;
}

/**
 * 各画面の見出し(1 行)。プロジェクトの画面では右端に保存状態を出す(保存状態の表示はここだけ)。
 */
export function Header({
  title,
  subtitle,
  actions,
  statusLabel,
  statusTone = 'neutral',
}: HeaderProps) {
  return (
    <header className="titlebar-drag flex min-h-12 shrink-0 items-center justify-between gap-4 border-b border-[var(--nv-color-border)] bg-[var(--nv-color-surface)] px-5 py-2">
      <div className="flex min-w-0 items-baseline gap-3">
        <h2 className="shrink-0 text-base font-semibold text-[var(--nv-color-text)]">{title}</h2>
        {subtitle && (
          <p className="min-w-0 truncate text-sm text-[var(--nv-color-muted)]" title={subtitle}>
            {subtitle}
          </p>
        )}
        {statusLabel && (
          <StatusChip tone={statusTone} label={statusLabel} className="self-center" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <SaveIndicator />
        {actions && <div className="titlebar-no-drag flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
