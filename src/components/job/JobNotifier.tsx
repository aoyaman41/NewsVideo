import { useEffect } from 'react';
import { ensureJobEvents, onJobTransition } from '../../stores/jobStore';
import { errorToastContent, explainError } from '../errors/explainError';
import { useToast } from '../ui';

/**
 * 自動生成の完成・失敗を通知で知らせる。どの画面(ようこそ画面を含む)にいても受け取れるよう、
 * アプリの最上位に常に置く。
 */
export function JobNotifier() {
  const toast = useToast();

  useEffect(() => {
    ensureJobEvents();
    return onJobTransition(({ job }) => {
      if (job.status === 'completed') {
        toast.success('画面上部の「動画を見る」から確認できます。', '動画ができました');
      } else if (job.status === 'failed') {
        const content = errorToastContent(
          explainError(job.error?.message ?? '', { kind: job.error?.kind }),
          '自動生成が途中で止まりました'
        );
        toast.error(content.message, content.title);
      }
    });
  }, [toast]);

  return null;
}
