import type { Part } from '../../schemas';
import { Button, Details } from '../ui';

/**
 * 以前の版で「読み上げ専用の文章」を設定したシーンの案内。
 * この文章は画面で編集できなくなったため、台本と違う読み方になることを示し、台本どおりに戻せるようにする。
 */
export function NarrationOverrideNotice({
  part,
  onUseScript,
}: {
  part: Part;
  onUseScript: () => void;
}) {
  if (!part.narrationText?.trim()) return null;
  return (
    <div
      role="status"
      className="space-y-2 rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-warning)]/30 bg-[var(--nv-color-warning)]/5 px-3 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-[var(--nv-color-text)]">
          このシーンは、台本とは別の「読み上げ用の文章」で読み上げます。
        </p>
        <Button size="sm" variant="secondary" onClick={onUseScript}>
          台本どおりに読む
        </Button>
      </div>
      <Details summary="読み上げ用の文章を見る">
        <p className="whitespace-pre-wrap text-sm text-[var(--nv-color-text)]">
          {part.narrationText}
        </p>
      </Details>
    </div>
  );
}
