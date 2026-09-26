import { useMemo } from 'react';
import type { Project } from '../../schemas';
import { estimateProjectGeneration } from '../../../shared/project/generationEstimate';
import type { AppSettings } from '../../../shared/settings/appSettings';
import { formatCost } from '../../utils/money';

const UNIT_LABELS: Record<string, { label: string; unit: string }> = {
  script: { label: '台本', unit: '件' },
  image: { label: '画像', unit: '枚' },
  audio: { label: '音声', unit: '件' },
};

/**
 * 「おまかせで作る」の前に出す費用の見込み(これから作る分だけ。これまでの累計は出さない)。
 * 幅ではなく「約 X(多くて Y)」で出す。多くては見込み × 1.3
 */
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
    <section className="nv-surface-muted px-4 py-3 text-sm" aria-label="費用の見込み">
      {items.length > 0 ? (
        <>
          <p className="font-semibold text-[var(--nv-color-text)]">
            費用の見込み: {formatCost(quote.usd, settings.jpyPerUsd)}
            <span className="font-normal text-[var(--nv-color-muted)]">
              (多くて {formatCost(quote.upperUsd, settings.jpyPerUsd)})
            </span>
          </p>
          <p className="mt-0.5 text-xs text-[var(--nv-color-muted)]">
            {items.join('・')}
            を作ります。文字数と設定から計算した見込みで、実際の金額は内容によって増減します(税は含みません。円は設定の為替レートで換算しています)。
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
