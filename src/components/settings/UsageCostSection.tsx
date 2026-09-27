import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '../ui';
import { FriendlyError } from '../errors/FriendlyError';
import { formatCost, formatJpyPerUsd } from '../../utils/money';
import {
  LEDGER_SERVICES,
  LEDGER_SERVICE_LABELS,
  type LedgerService,
  type UsageSummary,
} from '../../../shared/project/usageLedger';
import { isValidJpyPerUsd } from '../../../shared/settings/appSettings';

/**
 * 各社の利用状況と請求の画面。アプリの推定と実際の請求を見比べるときに開く
 * (URL は 2026-09 時点。変わっていたら直す)
 */
export const BILLING_PAGES: Record<LedgerService, { url: string; label: string }> = {
  anthropic: { url: 'https://platform.claude.com/usage', label: 'Anthropic(Claude)の利用状況' },
  openai: { url: 'https://platform.openai.com/usage', label: 'OpenAI の利用状況' },
  google: { url: 'https://aistudio.google.com/usage', label: 'Google AI Studio の利用状況' },
};

function formatMonth(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : '日付不明';
}

/**
 * 設定画面の「使った費用」区分。全体の台帳(プロジェクトを削除しても残る)から、月別・サービス別の合計を出す。
 * 金額はアプリ内の記録から計算した推定。為替レートもここで変える。
 */
export function UsageCostSection({
  jpyPerUsd,
  onChangeRate,
}: {
  jpyPerUsd: number;
  onChangeRate: (value: number) => void;
}) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [rateText, setRateText] = useState(String(jpyPerUsd));

  // 保存済みのレートを読み込んだとき(ほかの画面で変わったとき)は入力欄も合わせる
  const [shownRate, setShownRate] = useState(jpyPerUsd);
  if (shownRate !== jpyPerUsd) {
    setShownRate(jpyPerUsd);
    if (Number(rateText) !== jpyPerUsd) setRateText(String(jpyPerUsd));
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await window.electronAPI.usage.summary());
      setError(null);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cost = (usd: number) => formatCost(usd, jpyPerUsd);
  const rateInvalid = !isValidJpyPerUsd(Number(rateText));

  return (
    <Card
      title="使った費用"
      subtitle="アプリ内の記録から計算した推定で、実際の請求とは異なることがあります。"
      actions={
        <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>
          最新にする
        </Button>
      }
    >
      <div className="space-y-5">
        {error !== null && <FriendlyError title="使った費用を読み込めませんでした" error={error} />}

        {summary && (
          <section className="space-y-3" aria-label="使った費用の合計">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--nv-color-text)]">
                これまでの合計: {cost(summary.totalUsd)}
              </p>
              <p className="nv-help">{summary.count} 件の記録。削除した動画の分も含みます。</p>
            </div>
            {summary.months.length === 0 ? (
              <p className="nv-help">まだ記録がありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--nv-color-border)] text-left">
                      <th scope="col" className="nv-label py-2 pr-3">
                        月
                      </th>
                      {LEDGER_SERVICES.map((service) => (
                        <th key={service} scope="col" className="nv-label py-2 pr-3 text-right">
                          {LEDGER_SERVICE_LABELS[service]}
                        </th>
                      ))}
                      <th scope="col" className="nv-label py-2 text-right">
                        合計
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.months.map((month) => (
                      <tr
                        key={month.month || 'unknown'}
                        className="border-b border-[var(--nv-color-border)] text-[var(--nv-color-text)]"
                      >
                        <th scope="row" className="py-2 pr-3 text-left font-semibold">
                          {formatMonth(month.month)}
                        </th>
                        {LEDGER_SERVICES.map((service) => (
                          <td key={service} className="py-2 pr-3 text-right tabular-nums">
                            {month.totals[service] > 0 ? cost(month.totals[service]) : '—'}
                          </td>
                        ))}
                        <td className="py-2 text-right font-semibold tabular-nums">
                          {cost(month.totalUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {!summary && loading && <p className="nv-help">読み込み中…</p>}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">
            実際の請求を確かめる
          </h3>
          <ul className="space-y-1 text-sm">
            {LEDGER_SERVICES.map((service) => (
              <li key={service}>
                <a
                  href={BILLING_PAGES[service].url}
                  target="_blank"
                  rel="noreferrer"
                  className="nv-focus-ring rounded-[var(--nv-radius-sm)] font-semibold text-[var(--nv-color-accent)] underline"
                >
                  {BILLING_PAGES[service].label}を開く
                </a>
              </li>
            ))}
          </ul>
          <p className="nv-help">
            金額は、各社の料金表とアプリが記録したトークン数から計算しています。税や為替の手数料は含みません。
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">円の換算</h3>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="settings-jpy-per-usd" className="text-sm text-[var(--nv-color-text)]">
              1 ドル =
            </label>
            <input
              id="settings-jpy-per-usd"
              type="number"
              min="1"
              max="10000"
              step="0.1"
              value={rateText}
              onChange={(e) => {
                setRateText(e.target.value);
                const value = Number(e.target.value);
                if (e.target.value.trim() && isValidJpyPerUsd(value)) onChangeRate(value);
              }}
              className="nv-input w-28"
              aria-invalid={rateInvalid || undefined}
            />
            <span className="text-sm text-[var(--nv-color-text)]">円</span>
          </div>
          <p className="nv-help">
            {rateInvalid
              ? '1〜10000 の数を入れてください。今は ' +
                formatJpyPerUsd(jpyPerUsd) +
                ' で表示しています。'
              : '費用の見込みや使った費用を、円とドルの両方で表示するときに使います(既定は 1 ドル = 150 円)。'}
          </p>
        </section>
      </div>
    </Card>
  );
}
