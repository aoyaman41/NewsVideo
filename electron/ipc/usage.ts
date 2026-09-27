import { app } from 'electron';
import { registerOperation } from './operations';
import { getUsageLedger } from '../usage/ledgerService';
import { logger } from '../utils/logger';
import type { UsageSummary } from '../../shared/project/usageLedger';

// 起動したら台帳を用意しておく(初回は既存の全プロジェクトから作る。プロジェクトを削除する前に作っておくため)。
// 台帳があるときは、前回の終了の直前に保存された分など、台帳にない usage を補う
void app
  .whenReady()
  .then(() => getUsageLedger().reconcile())
  .catch((error) => {
    logger.warn('Usage ledger could not be prepared', {
      code: (error as NodeJS.ErrnoException)?.code,
    });
  });

// 設定画面の「使った費用」: 月別・サービス別の合計(アプリ内の記録から計算した推定)
registerOperation('usage:summary', async (): Promise<UsageSummary> => getUsageLedger().summary());
