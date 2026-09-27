import { z } from 'zod';
import { usageRecordSchema, type UsageRecord } from './schema';
import { estimateUsageCostUsd, type CostRates } from '../../src/utils/cost';

/**
 * 使用量の全体の台帳(プロジェクトを削除しても残る)。Main が userData の usage-ledger.json に保存する。
 * 1 件は、プロジェクトの usage の 1 件(日時・プロバイダ・用途・モデル・トークン数など。本文や API キーは
 * もともと含まない)に、プロジェクトの ID と名前、記録したときの料金表で計算した金額を足したもの。
 * 重複は usage の ID で防ぐ。
 */
export const ledgerEntrySchema = usageRecordSchema.extend({
  projectId: z.string(),
  projectName: z.string(),
  /** 記録したときの料金表で計算した金額(USD)。料金表があとで変わっても、過去の金額は変えない */
  costUsd: z.number().finite().nonnegative(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const LEDGER_VERSION = 1;

export const ledgerFileSchema = z.object({
  version: z.literal(LEDGER_VERSION),
  /** 台帳を作った日時(初回に既存の全プロジェクトから作った日時) */
  createdAt: z.string(),
  entries: z.array(z.unknown()),
});

export type LedgerFile = {
  version: typeof LEDGER_VERSION;
  createdAt: string;
  entries: LedgerEntry[];
};

/** 台帳に記録するプロジェクト 1 件分の使用量 */
export type UsageSource = {
  projectId: string;
  projectName: string;
  usage: UsageRecord[];
};

/** 請求画面の区分(Gemini は Google) */
export const LEDGER_SERVICES = ['anthropic', 'openai', 'google'] as const;
export type LedgerService = (typeof LEDGER_SERVICES)[number];

export const LEDGER_SERVICE_LABELS: Record<LedgerService, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

export function serviceOfProvider(provider: UsageRecord['provider']): LedgerService {
  return provider === 'gemini' ? 'google' : provider;
}

export function toLedgerEntry(
  record: UsageRecord,
  source: Pick<UsageSource, 'projectId' | 'projectName'>,
  rates: CostRates
): LedgerEntry {
  const cost = estimateUsageCostUsd(record, rates);
  return {
    ...record,
    projectId: source.projectId,
    projectName: source.projectName,
    costUsd: Number.isFinite(cost) && cost > 0 ? cost : 0,
  };
}

/** 台帳の中身を検証する。形の合わない行だけを捨てる(1 行が壊れていても、ほかの行は残す) */
export function parseLedgerEntries(entries: unknown[]): LedgerEntry[] {
  const seen = new Set<string>();
  const result: LedgerEntry[] = [];
  for (const item of entries) {
    const parsed = ledgerEntrySchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    result.push(parsed.data);
  }
  return result;
}

/**
 * 新しい記録だけを台帳の行にする(記録済みの ID と、同じ一覧の中の重複は除く)。
 */
export function newLedgerEntries(
  source: UsageSource,
  known: ReadonlySet<string>,
  rates: CostRates
): LedgerEntry[] {
  const seen = new Set<string>();
  const result: LedgerEntry[] = [];
  for (const record of source.usage) {
    if (known.has(record.id) || seen.has(record.id)) continue;
    seen.add(record.id);
    result.push(toLedgerEntry(record, source, rates));
  }
  return result;
}

export type ServiceTotals = Record<LedgerService, number>;

export type MonthlyUsage = {
  /** YYYY-MM(この Mac の時刻で区切る)。日時が読めない行は空文字 */
  month: string;
  totals: ServiceTotals;
  totalUsd: number;
  count: number;
};

export type UsageSummary = {
  /** 新しい月から順 */
  months: MonthlyUsage[];
  totals: ServiceTotals;
  totalUsd: number;
  count: number;
  /** 台帳を作った日時。まだない(読めない)ときは null */
  ledgerCreatedAt: string | null;
};

function emptyTotals(): ServiceTotals {
  return { anthropic: 0, openai: 0, google: 0 };
}

/** 日時を、この Mac の時刻の YYYY-MM にする */
export function monthKeyOf(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function summarizeLedger(
  entries: readonly LedgerEntry[],
  ledgerCreatedAt: string | null = null
): UsageSummary {
  const months = new Map<string, MonthlyUsage>();
  const totals = emptyTotals();
  let totalUsd = 0;
  for (const entry of entries) {
    const key = monthKeyOf(entry.createdAt);
    const month = months.get(key) ?? { month: key, totals: emptyTotals(), totalUsd: 0, count: 0 };
    const service = serviceOfProvider(entry.provider);
    month.totals[service] += entry.costUsd;
    month.totalUsd += entry.costUsd;
    month.count++;
    months.set(key, month);
    totals[service] += entry.costUsd;
    totalUsd += entry.costUsd;
  }
  return {
    // 日時が読めない行(空文字)は最後にする
    months: [...months.values()].sort((a, b) =>
      a.month === '' ? 1 : b.month === '' ? -1 : b.month.localeCompare(a.month)
    ),
    totals,
    totalUsd,
    count: entries.length,
    ledgerCreatedAt,
  };
}
