import { app } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../../shared/project/schema';
import type { UsageSource } from '../../shared/project/usageLedger';
import { normalizeSettings } from '../../shared/settings/appSettings';
import { normalizeCostRates } from '../../src/utils/cost';
import { ProjectRepository } from '../project/repository';
import { logger } from '../utils/logger';
import { UsageLedger } from './ledger';

/**
 * 使用量の台帳(electron/usage/ledger.ts)をアプリで 1 つだけ作る。
 * プロジェクトの保存(ProjectRepository の onPersist)から recordUsageInLedger を呼ぶ。
 */
let ledger: UsageLedger | undefined;

const userData = () => app.getPath('userData');

async function readCostRates() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(userData(), 'settings.json'), 'utf8'));
    return normalizeCostRates(normalizeSettings(raw).cost);
  } catch {
    return normalizeCostRates(undefined);
  }
}

/** projects と trash(ごみ箱)の中の全プロジェクトの usage を読む。読めないプロジェクトは飛ばす */
export async function scanProjectUsage(roots: string[]): Promise<UsageSource[]> {
  const sources: UsageSource[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = (await fs.readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.endsWith('.newsproj'))
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    // 読むだけ(保存しない)なので、台帳への追記の仕組みは付けない
    const repository = new ProjectRepository(root);
    for (const name of names) {
      try {
        const project = await repository.readDirectory(path.join(root, name));
        sources.push({ projectId: project.id, projectName: project.name, usage: project.usage });
      } catch {
        /* 読めないプロジェクトは、直して保存されたときに記録する */
      }
    }
  }
  return sources;
}

export function getUsageLedger(): UsageLedger {
  ledger ??= new UsageLedger({
    filePath: path.join(userData(), 'usage-ledger.json'),
    scan: () =>
      scanProjectUsage([path.join(userData(), 'projects'), path.join(userData(), 'trash')]),
    rates: readCostRates,
    onRecovered: () => logger.warn('Usage ledger was unreadable and has been rebuilt'),
  });
  return ledger;
}

/** 保存されたプロジェクトの新しい usage を台帳に追記する。失敗しても保存には影響させない */
export function recordUsageInLedger(project: Project): Promise<void> {
  if (project.usage.length === 0) return Promise.resolve();
  // 追記は順番待ちのあとに行うので、保存した時点の一覧を写しておく
  return getUsageLedger()
    .record({ projectId: project.id, projectName: project.name, usage: [...project.usage] })
    .then(
      () => undefined,
      (error) => {
        logger.warn('Usage ledger update failed', {
          code: (error as NodeJS.ErrnoException)?.code,
        });
      }
    );
}
