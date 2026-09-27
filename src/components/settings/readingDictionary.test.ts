import { expect, it } from 'vitest';
import { entriesToRows, rowProblem, rowsToEntries, type ReadingRow } from './readingDictionary';

let counter = 0;
const id = () => `row-${++counter}`;

it('round-trips saved entries through editable rows', () => {
  const rows = entriesToRows([{ word: '東京都', reading: 'とうきょうと' }], id);
  expect(rows).toEqual([{ id: expect.any(String), word: '東京都', reading: 'とうきょうと' }]);
  expect(rowsToEntries(rows)).toEqual([{ word: '東京都', reading: 'とうきょうと' }]);
  expect(entriesToRows(undefined, id)).toEqual([]);
});

it('saves only complete rows, trimmed', () => {
  const rows: ReadingRow[] = [
    { id: 'a', word: '  円安 ', reading: ' えんやす ' },
    { id: 'b', word: '日銀', reading: '' },
    { id: 'c', word: '', reading: '' },
  ];
  expect(rowsToEntries(rows)).toEqual([{ word: '円安', reading: 'えんやす' }]);
});

it('explains rows that will not be saved or will be shadowed', () => {
  const rows: ReadingRow[] = [
    { id: 'a', word: '日銀', reading: 'にちぎん' },
    { id: 'b', word: '日銀', reading: 'にほんぎんこう' },
    { id: 'c', word: '', reading: 'よみ' },
    { id: 'd', word: '表記', reading: '' },
    { id: 'e', word: '', reading: '' },
  ];
  expect(rowProblem(rows[0], rows)).toBeNull();
  expect(rowProblem(rows[1], rows)).toContain('同じ表記');
  expect(rowProblem(rows[2], rows)).toContain('表記を入力');
  expect(rowProblem(rows[3], rows)).toContain('読みを入力');
  expect(rowProblem(rows[4], rows)).toBeNull();
});
