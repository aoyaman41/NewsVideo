import type { ImageAssetRef } from '../../schemas';

/**
 * シーンで使う画像の並び(panelImages)を操作する関数。
 * 書き出しでは並びのすべての画像を順に使うので、1 枚を選んでも他の画像は消さない。
 */

/** 差し替え先。番号は 0 始まりの枠、'new' は末尾に新しい枠を足す */
export type SlotTarget = number | 'new';

/** 並びの長さに合わない差し替え先を、使える値に直す */
export function normalizeTarget(refs: ImageAssetRef[], target: SlotTarget): SlotTarget {
  if (target === 'new') return 'new';
  if (refs.length === 0) return 'new';
  return target >= 0 && target < refs.length ? target : 0;
}

/** 差し替え先の枠に画像を入れる。'new' のとき(または枠がないとき)は末尾に足す */
export function placeImage(
  refs: ImageAssetRef[],
  target: SlotTarget,
  imageId: string
): ImageAssetRef[] {
  const slot = normalizeTarget(refs, target);
  if (slot === 'new') return [...refs, { imageId }];
  return refs.map((ref, index) => (index === slot ? { ...ref, imageId } : ref));
}

/** 枠を外す */
export function removeSlot(refs: ImageAssetRef[], index: number): ImageAssetRef[] {
  return refs.filter((_, i) => i !== index);
}

/** 枠の順番を入れ替える(delta: -1 で前へ、+1 で後ろへ) */
export function moveSlot(refs: ImageAssetRef[], index: number, delta: -1 | 1): ImageAssetRef[] {
  const to = index + delta;
  if (index < 0 || index >= refs.length || to < 0 || to >= refs.length) return refs;
  const next = [...refs];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** 表示秒数を指定する。0 以下や空欄は自動(指定なし)に戻す */
export function setSlotDuration(
  refs: ImageAssetRef[],
  index: number,
  seconds: number | undefined
): ImageAssetRef[] {
  return refs.map((ref, i) => {
    if (i !== index) return ref;
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
      // 指定なしに戻すときは項目ごと外す(保存データに undefined を残さない)
      const rest = { ...ref };
      delete rest.displayDurationSec;
      return rest;
    }
    return { ...ref, displayDurationSec: seconds };
  });
}
