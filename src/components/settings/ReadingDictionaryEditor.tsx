import { useState } from 'react';
import type { ReadingEntry } from '../../../shared/project/narration';
import { Button } from '../ui';
import {
  READING_ENTRIES_MAX,
  READING_MAX,
  READING_WORD_MAX,
  entriesToRows,
  rowProblem,
  rowsToEntries,
  type ReadingRow,
} from './readingDictionary';

const newId = () => crypto.randomUUID();

/**
 * 読み辞書(全プロジェクト共通)。ナレーションで読み間違える言葉の読みを登録する。
 * 入力欄から離れたとき・行を消したときに、保存できる行だけを設定へ反映する(設定は自動保存)。
 */
export function ReadingDictionaryEditor({
  entries,
  onCommit,
}: {
  entries: readonly ReadingEntry[] | undefined;
  onCommit: (entries: ReadingEntry[]) => void;
}) {
  const [rows, setRows] = useState<ReadingRow[]>(() => {
    const initial = entriesToRows(entries, newId);
    return initial.length > 0 ? initial : [{ id: newId(), word: '', reading: '' }];
  });

  const commit = (next: ReadingRow[]) => onCommit(rowsToEntries(next));
  const update = (id: string, patch: Partial<ReadingRow>) =>
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id: string) => {
    const next = rows.filter((row) => row.id !== id);
    const ensured = next.length > 0 ? next : [{ id: newId(), word: '', reading: '' }];
    setRows(ensured);
    commit(ensured);
  };
  const add = () => setRows((previous) => [...previous, { id: newId(), word: '', reading: '' }]);
  const savedCount = rowsToEntries(rows).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 text-xs font-semibold text-[var(--nv-color-muted)]">
        <span>表記(記事や台本の書き方)</span>
        <span>読み(ひらがな・カタカナ)</span>
        <span className="sr-only">操作</span>
      </div>
      <ul className="space-y-2">
        {rows.map((row, index) => {
          const problem = rowProblem(row, rows);
          return (
            <li key={row.id}>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                <input
                  aria-label={`${index + 1} 行目の表記`}
                  value={row.word}
                  maxLength={READING_WORD_MAX}
                  onChange={(event) => update(row.id, { word: event.target.value })}
                  onBlur={() => commit(rows)}
                  placeholder="例: 東京都"
                  className="nv-input text-sm"
                />
                <input
                  aria-label={`${index + 1} 行目の読み`}
                  value={row.reading}
                  maxLength={READING_MAX}
                  onChange={(event) => update(row.id, { reading: event.target.value })}
                  onBlur={() => commit(rows)}
                  placeholder="例: とうきょうと"
                  className="nv-input text-sm"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${index + 1} 行目を削除`}
                  onClick={() => remove(row.id)}
                >
                  削除
                </Button>
              </div>
              {problem && (
                <p className="mt-1 text-xs text-[var(--nv-color-warning)]" role="status">
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={add}
          disabled={rows.length >= READING_ENTRIES_MAX}
        >
          行を追加
        </Button>
        <p className="text-xs text-[var(--nv-color-muted)]">
          登録済み {savedCount} 件(最大 {READING_ENTRIES_MAX} 件)
        </p>
      </div>
    </div>
  );
}
