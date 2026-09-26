import { describe, expect, it } from 'vitest';
import { moveSlot, normalizeTarget, placeImage, removeSlot, setSlotDuration } from './panelSlots';

const a = '00000000-0000-4000-8000-00000000000a';
const b = '00000000-0000-4000-8000-00000000000b';
const c = '00000000-0000-4000-8000-00000000000c';

describe('panelSlots', () => {
  it('候補を選ぶと、差し替え先の枠だけを入れ替え、他の画像は残す', () => {
    const refs = [{ imageId: a }, { imageId: b, displayDurationSec: 2 }];
    expect(placeImage(refs, 1, c)).toEqual([{ imageId: a }, { imageId: c, displayDurationSec: 2 }]);
  });

  it('新しい枠を選んでいるときは末尾に足す', () => {
    expect(placeImage([{ imageId: a }], 'new', b)).toEqual([{ imageId: a }, { imageId: b }]);
  });

  it('枠がないときは 1 枚目として足す', () => {
    expect(placeImage([], 0, a)).toEqual([{ imageId: a }]);
  });

  it('範囲外の差し替え先は先頭の枠として扱う', () => {
    expect(normalizeTarget([{ imageId: a }], 5)).toBe(0);
    expect(normalizeTarget([], 0)).toBe('new');
  });

  it('枠を外す・並べ替える', () => {
    const refs = [{ imageId: a }, { imageId: b }, { imageId: c }];
    expect(removeSlot(refs, 1)).toEqual([{ imageId: a }, { imageId: c }]);
    expect(moveSlot(refs, 0, 1).map((ref) => ref.imageId)).toEqual([b, a, c]);
    expect(moveSlot(refs, 0, -1)).toBe(refs);
  });

  it('表示秒数を空欄にすると項目ごと外す', () => {
    const refs = [{ imageId: a, displayDurationSec: 3 }];
    expect(setSlotDuration(refs, 0, undefined)).toEqual([{ imageId: a }]);
    expect(setSlotDuration(refs, 0, 4.5)).toEqual([{ imageId: a, displayDurationSec: 4.5 }]);
  });
});
