/**
 * 並列数を絞って順に処理する。まだ始めていない項目は task 側で中止を確かめて飛ばせる。
 * (同時に実行する API の数は Main 側でも制限する)
 */
export async function runLimited<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  });
  await Promise.all(workers);
}
