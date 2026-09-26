import { useCallback, useState } from 'react';
import { useToast } from '../ui';
import {
  errorToastContent,
  explainError,
  explainFailures,
  type ReportedError,
} from './explainError';

/**
 * 作業画面(台本・画像・音声・動画)のエラーの出し方をそろえる。
 * 失敗したら通知を出し、画面上部に FriendlyError で原因と次の操作を残す。
 */
export function useErrorReport() {
  const toast = useToast();
  const [reported, setReported] = useState<ReportedError | null>(null);

  /** 例外を報告する。title は「何に失敗したか」(例:「画像を作れませんでした」) */
  const report = useCallback(
    (error: unknown, title: string) => {
      console.error(title, error);
      const explanation = explainError(error);
      setReported({ title, explanation });
      const content = errorToastContent(explanation, title);
      toast.error(content.message, content.title);
    },
    [toast]
  );

  /** まとめて作る処理で、一部のシーンが失敗したときに使う */
  const reportFailures = useCallback(
    (title: string, failures: Array<{ label: string; error: unknown }>) => {
      if (failures.length === 0) return;
      setReported({ title, explanation: explainFailures(failures) });
      toast.warning(`${failures.length} 件のシーンで失敗しました。`, title);
    },
    [toast]
  );

  const clear = useCallback(() => setReported(null), []);

  return { reported, report, reportFailures, clear };
}
