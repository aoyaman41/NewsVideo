import { useEffect, useState } from 'react';
import type { Project } from '../../schemas';
import { estimateProjectGeneration } from '../../../shared/project/generationEstimate';
import { normalizeSettings, type AppSettings } from '../../../shared/settings/appSettings';
import { formatUsd, normalizeCostRates, sumUsageCostUsd } from '../../utils/cost';

export function GenerationQuote({ project, partCount }: { project: Project; partCount: number }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    let active = true;
    void window.electronAPI.settings.get().then((value) => {
      if (active) setSettings(normalizeSettings(value));
    });
    return () => {
      active = false;
    };
  }, []);
  if (!settings) return null;
  const quote = estimateProjectGeneration(project, settings, partCount);
  return (
    <section
      className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm"
      aria-label="生成前の費用見積もり"
    >
      <p>
        これまでの概算使用額：
        {formatUsd(sumUsageCostUsd(project.usage, normalizeCostRates(settings.cost)))}
      </p>
      <p className="font-semibold">
        これからの見積もり：{formatUsd(quote.lowerUsd)} 〜 {formatUsd(quote.upperUsd)}
      </p>
      <p className="text-xs">
        {quote.steps.map((step) => `${step.label} ${step.count}件`).join(' / ')}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        文字数・生成サイズと登録単価から計算した幅です。推論量や画像の内容で増減します。税・為替は含みません。書き出し処理のAPI料金はありません。
      </p>
    </section>
  );
}
