import { useMemo } from 'react';
import type { Project } from '../../schemas';
import { estimateProjectGeneration } from '../../../shared/project/generationEstimate';
import type { AppSettings } from '../../../shared/settings/appSettings';
import { formatUsdShort } from '../job/jobDisplay';

const UNIT_LABELS: Record<string, { label: string; unit: string }> = {
  script: { label: '台本', unit: '件' },
  image: { label: '画像', unit: '枚' },
  audio: { label: '音声', unit: '件' },
};

/** 「おまかせで作る」の前に出す費用の目安(これから作る分だけ。これまでの累計は出さない) */
export function GenerationQuote({
  project,
  partCount,
  settings,
}: {
  project: Project;
  partCount: number;
  settings: AppSettings;
}) {
  const quote = useMemo(
    () => estimateProjectGeneration(project, settings, partCount),
    [partCount, project, settings]
  );
  // 画像の指示づくりは画像の費用に含めて見せる(件数は出さない)
  const items = quote.steps
    .filter((step) => step.kind !== 'prompt' && step.count > 0)
    .map(
      (step) =>
        `${UNIT_LABELS[step.kind]?.label ?? step.label} ${step.count} ${UNIT_LABELS[step.kind]?.unit ?? '件'}`
    );

  return (
    <section className="nv-surface-muted px-4 py-3 text-sm" aria-label="費用の目安">
      {items.length > 0 ? (
        <>
          <p className="font-semibold text-[var(--nv-color-text)]">
            費用の目安: {formatUsdShort(quote.lowerUsd)} 〜 {formatUsdShort(quote.upperUsd)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--nv-color-muted)]">
            {items.join('・')}
            を作ります。文字数と設定から計算した目安で、実際の金額は内容によって増減します(税・為替は含みません)。
          </p>
        </>
      ) : (
        <p className="text-[var(--nv-color-muted)]">
          新しく作るものはありません。押すと、動画が古いときだけ書き出し直します(書き出しに AI
          の料金はかかりません)。
        </p>
      )}
    </section>
  );
}
