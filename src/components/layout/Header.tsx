import { StatusChip } from '../ui';
import type { Tone } from '../../types/ui';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  statusLabel?: string;
  statusTone?: Tone;
}

export function Header({
  title,
  subtitle,
  actions,
  statusLabel,
  statusTone = 'neutral',
}: HeaderProps) {
  return (
    <header className="titlebar-drag border-b border-[var(--nv-color-border)] bg-white/90 px-5 py-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-slate-900">{title}</h2>
            {statusLabel && <StatusChip tone={statusTone} label={statusLabel} />}
          </div>
          {subtitle && <p className="mt-1 truncate text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="titlebar-no-drag flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
