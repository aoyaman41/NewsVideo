import type { ReactNode } from 'react';
import type { Part, Project } from '../../schemas';
import { approveAssets, partFreshness } from '../../../shared/project/integrity';
import { Button } from '../ui';

type AssetKind = 'script' | 'image' | 'audio';

const NAMES: Record<AssetKind, string> = { script: '台本', image: '画像', audio: '音声' };

function staleMessage(kinds: AssetKind[]): string {
  if (kinds.length === 1 && kinds[0] === 'script') {
    return '記事が変わったため、この台本は古くなっている可能性があります。';
  }
  const names = kinds.map((kind) => NAMES[kind]).join('と');
  return `台本や設定が変わったため、このシーンの${names}は古くなっている可能性があります。`;
}

/**
 * 素材が古くなったときだけ出す短い案内(1 つの枠にまとめる)。
 * 「このまま使う」を選ぶと、今の内容で問題ないものとして記録する。
 */
export function StaleNotice({
  project,
  part,
  kinds,
  onChange,
  renderAction,
}: {
  project: Project;
  part: Part;
  kinds: AssetKind[];
  onChange: (project: Project) => void;
  /** 「作り直す」などの操作。古くなった種類ごとに返す */
  renderAction?: (kind: AssetKind) => ReactNode;
}) {
  const freshness = partFreshness(project, part);
  const stale = kinds.filter((kind) => freshness[kind] === 'stale');
  if (stale.length === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-warning)]/30 bg-[var(--nv-color-warning)]/5 px-3 py-2"
    >
      <p className="min-w-0 flex-1 text-sm text-[var(--nv-color-text)]">{staleMessage(stale)}</p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {stale.map((kind) => (
          <span key={kind} className="contents">
            {renderAction?.(kind)}
          </span>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange(approveAssets(project, part.id, stale))}
        >
          このまま使う
        </Button>
      </div>
    </div>
  );
}
