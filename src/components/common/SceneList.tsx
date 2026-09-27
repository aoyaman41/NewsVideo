import type { ReactNode } from 'react';
import { cx } from '../../utils/cx';

type SceneLike = { id: string; title: string };

/** 画像・音声・動画の画面で共通の、シーンを選ぶための一覧 */
export function SceneList<T extends SceneLike>({
  scenes,
  selectedId,
  onSelect,
  renderStatus,
  subtitle,
  className,
}: {
  scenes: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 各シーンの状態(バッジなど) */
  renderStatus?: (scene: T, index: number) => ReactNode;
  subtitle?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="シーン"
      className={cx('nv-surface flex min-h-0 flex-col overflow-hidden', className)}
    >
      <div className="border-b border-[var(--nv-color-border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">シーン</h3>
        {subtitle && <p className="nv-help mt-0.5">{subtitle}</p>}
      </div>
      <ul className="nv-scrollbar min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
        {scenes.map((scene, index) => {
          const selected = scene.id === selectedId;
          return (
            <li key={scene.id}>
              <button
                type="button"
                onClick={() => onSelect(scene.id)}
                aria-current={selected ? 'true' : undefined}
                className={cx(
                  'nv-focus-ring w-full rounded-[var(--nv-radius-sm)] border px-3 py-2 text-left transition-colors duration-[var(--nv-duration-fast)]',
                  selected
                    ? 'border-[var(--nv-color-accent)] bg-[var(--nv-color-accent)]/10'
                    : 'border-transparent hover:border-[var(--nv-color-border)] hover:bg-[var(--nv-color-canvas)]'
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="w-5 shrink-0 text-right text-xs font-semibold text-[var(--nv-color-muted)] tabular-nums">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm font-semibold text-[var(--nv-color-text)]">
                    {scene.title || '(見出しなし)'}
                  </span>
                </div>
                {renderStatus && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 pl-7 text-xs">
                    {renderStatus(scene, index)}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
