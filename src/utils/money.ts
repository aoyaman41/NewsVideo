import { DEFAULT_JPY_PER_USD, isValidJpyPerUsd } from '../../shared/settings/appSettings';

/**
 * 金額の表示(全画面でこの関数を使う)。円とドルを併記する: 「約 76 円($0.51)」。
 * 円は設定の為替レート(1 ドルあたりの円。既定 150)で換算する。料金はすべて推定なので、既定で「約」を付ける。
 * - 0 以下・数でない値: 「0 円($0.00)」
 * - 1 円未満: 「1 円未満($0.01 未満)」のように書く
 */
export function formatCost(
  usd: number,
  jpyPerUsd: number,
  options: { approx?: boolean } = {}
): string {
  const approx = options.approx ?? true;
  if (!Number.isFinite(usd) || usd <= 0) return '0 円($0.00)';
  const rate = isValidJpyPerUsd(jpyPerUsd) ? jpyPerUsd : DEFAULT_JPY_PER_USD;
  const yen = usd * rate;
  const yenText =
    yen < 1 ? '1 円未満' : `${approx ? '約 ' : ''}${Math.round(yen).toLocaleString('ja-JP')} 円`;
  const usdText =
    usd < 0.01
      ? '$0.01 未満'
      : `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${yenText}(${usdText})`;
}

/** 為替レートの表示(「1 ドル = 150 円」) */
export function formatJpyPerUsd(jpyPerUsd: number): string {
  const rate = isValidJpyPerUsd(jpyPerUsd) ? jpyPerUsd : DEFAULT_JPY_PER_USD;
  return `1 ドル = ${rate.toLocaleString('ja-JP', { maximumFractionDigits: 2 })} 円`;
}
