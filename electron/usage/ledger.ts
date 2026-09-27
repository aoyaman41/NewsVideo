import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CostRates } from '../../src/utils/cost';
import {
  LEDGER_VERSION,
  ledgerFileSchema,
  newLedgerEntries,
  parseLedgerEntries,
  summarizeLedger,
  type LedgerEntry,
  type LedgerFile,
  type UsageSource,
  type UsageSummary,
} from '../../shared/project/usageLedger';

export type UsageLedgerOptions = {
  /** 台帳のファイル(userData/usage-ledger.json) */
  filePath: string;
  /** 台帳がまだないときに 1 回だけ読む、既存の全プロジェクトの使用量 */
  scan: () => Promise<UsageSource[]>;
  /** 金額の計算に使う料金表(記録するときの設定) */
  rates: () => Promise<CostRates>;
  now?: () => Date;
  /** 台帳を読めなかったときの通知(壊れたファイルは退避して作り直す) */
  onRecovered?: (backupPath: string) => void;
};

type State = { createdAt: string; entries: LedgerEntry[]; ids: Set<string> };

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/**
 * 使用量の全体の台帳。プロジェクトを削除(ごみ箱へ移動)しても合計が減らないよう、usage を記録するたびに
 * ここへも追記する。保存形式は 1 つの JSON(usage-ledger.json)で、書き込みは一時ファイルからの置き換え
 * (途中で止まっても前の内容が残る)。読み書きは 1 件ずつ順に行う。
 *
 * - 台帳がまだないときは、既存の全プロジェクト(ごみ箱を含む)の usage から 1 回だけ作る
 * - 起動時は、今あるプロジェクトの usage のうち台帳にないもの(保存の直後に終了した分など)を補う(reconcile)
 * - 重複は usage の ID で防ぐ(同じプロジェクトを何度保存しても、複製・復元しても二重に数えない)
 * - 台帳が壊れていたときは、壊れたファイルを残したまま退避し、既存のプロジェクトから作り直す
 */
export class UsageLedger {
  private state: State | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private options: UsageLedgerOptions) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** 台帳を読み込む(なければ作る)。起動時に呼んでおくと、最初の記録や表示を待たせない */
  ready(): Promise<void> {
    return this.serial(async () => {
      await this.load();
    });
  }

  /**
   * 起動時の照合。台帳を読み込み(なければ既存の全プロジェクトから作る)、すでに台帳があったときは、
   * 今あるプロジェクトの usage のうち台帳にないもの(保存の直後にアプリが終了した・追記に失敗した分)を補う。
   * 台帳から消すことはしない(削除したプロジェクトの分は残す)。補った件数を返す
   */
  reconcile(): Promise<number> {
    return this.serial(async () => {
      const builtNow = this.state === null && !(await this.exists());
      const state = await this.load();
      if (builtNow) return 0;
      const sources = await this.options.scan();
      if (!sources.some((source) => source.usage.some((record) => !state.ids.has(record.id))))
        return 0;
      return this.append(state, sources, await this.options.rates());
    });
  }

  /** プロジェクトの usage のうち、まだ台帳にないものを追記する。追記した件数を返す */
  record(source: UsageSource): Promise<number> {
    return this.serial(async () => {
      const state = await this.load();
      if (!source.usage.some((record) => !state.ids.has(record.id))) return 0;
      return this.append(state, [source], await this.options.rates());
    });
  }

  private async append(state: State, sources: UsageSource[], rates: CostRates): Promise<number> {
    const ids = new Set(state.ids);
    const entries: LedgerEntry[] = [];
    for (const source of sources) {
      const added = newLedgerEntries(source, ids, rates);
      for (const entry of added) ids.add(entry.id);
      entries.push(...added);
    }
    if (entries.length === 0) return 0;
    const next = [...state.entries, ...entries];
    await this.write({ version: LEDGER_VERSION, createdAt: state.createdAt, entries: next });
    state.entries = next;
    state.ids = ids;
    return entries.length;
  }

  private async exists(): Promise<boolean> {
    try {
      await fs.access(this.options.filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** 月別・サービス別の合計 */
  summary(): Promise<UsageSummary> {
    return this.serial(async () => {
      const state = await this.load();
      return summarizeLedger(state.entries, state.createdAt);
    });
  }

  private async load(): Promise<State> {
    if (this.state) return this.state;
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.options.filePath, 'utf8');
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (raw !== null) {
      const parsed = (() => {
        try {
          return ledgerFileSchema.safeParse(JSON.parse(raw));
        } catch {
          return null;
        }
      })();
      if (parsed?.success) {
        const entries = parseLedgerEntries(parsed.data.entries);
        this.state = {
          createdAt: parsed.data.createdAt,
          entries,
          ids: new Set(entries.map((entry) => entry.id)),
        };
        return this.state;
      }
      // 読めない台帳は消さずに退避し、既存のプロジェクトから作り直す(削除済みのプロジェクトの分は退避先に残る)
      const backup = `${this.options.filePath}.broken-${(this.options.now?.() ?? new Date()).getTime()}`;
      await fs.rename(this.options.filePath, backup);
      this.options.onRecovered?.(backup);
    }
    return this.build();
  }

  private async build(): Promise<State> {
    const createdAt = (this.options.now?.() ?? new Date()).toISOString();
    const [sources, rates] = await Promise.all([this.options.scan(), this.options.rates()]);
    const ids = new Set<string>();
    const entries: LedgerEntry[] = [];
    for (const source of sources) {
      const added = newLedgerEntries(source, ids, rates);
      for (const entry of added) ids.add(entry.id);
      entries.push(...added);
    }
    entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // 書き込みに失敗しても、作った内容はメモリに残す(保存のたびに全プロジェクトを読み直さない)。
    // 次の追記のときに、全体をまとめて書き込む
    this.state = { createdAt, entries, ids };
    await this.write({ version: LEDGER_VERSION, createdAt, entries });
    return this.state;
  }

  private async write(file: LedgerFile) {
    const target = this.options.filePath;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}
