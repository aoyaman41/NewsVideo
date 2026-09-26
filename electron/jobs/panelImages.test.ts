import { expect, it } from 'vitest';
import { replaceLeadImage } from './panelImages';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

it('replaces only the first slot and keeps the other images of the scene', () => {
  expect(
    replaceLeadImage(
      [{ imageId: id(1), displayDurationSec: 4 }, { imageId: id(2) }, { imageId: id(3) }],
      id(9)
    )
  ).toEqual([{ imageId: id(9), displayDurationSec: 4 }, { imageId: id(2) }, { imageId: id(3) }]);
});

it('puts the image into an empty scene', () => {
  expect(replaceLeadImage([], id(9))).toEqual([{ imageId: id(9) }]);
});

it('does not change the original list', () => {
  const original = [{ imageId: id(1) }, { imageId: id(2) }];
  replaceLeadImage(original, id(9));
  expect(original).toEqual([{ imageId: id(1) }, { imageId: id(2) }]);
});
