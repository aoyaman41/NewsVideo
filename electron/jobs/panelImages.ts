import type { ImageAssetRef } from '../../shared/project/schema';

/**
 * シーンの画像を作り直したときの割り当て。1 シーンに複数の画像を置けるため、先頭の枠(1 枚目)だけを
 * 新しい画像に差し替え、2 枚目以降と先頭の枠の表示時間はそのまま残す。枠が空なら 1 枚目として入れる。
 * (画面の「足りない画像を作る」と同じ挙動。自動生成ジョブと、ジョブ履歴からの復元で使う)
 */
export function replaceLeadImage(panelImages: ImageAssetRef[], imageId: string): ImageAssetRef[] {
  const [lead, ...rest] = panelImages;
  return [{ ...lead, imageId }, ...rest];
}
