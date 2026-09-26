import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppSettings } from '../../shared/settings/appSettings';

export const generationSettings = new AsyncLocalStorage<AppSettings>();

export type RenderProgress = { percent: number; message?: string };

/**
 * 自動生成ジョブが、共通の操作(invokeOperation)を呼ぶときに渡す付帯情報。
 * IPC の引数には載せない(画面からの呼び出しでは常に空)。
 */
export type JobOperationContext = {
  /** 生成の応答が始まったとき(Claude のストリーミングで最初のイベントを受け取ったとき)に 1 回呼ぶ */
  onResponseStart?: () => void;
  /** 動画の書き出しの進み具合(0〜100) */
  onRenderProgress?: (progress: RenderProgress) => void;
  /** ジョブの停止。書き出し中のプロセスを止めるのに使う */
  signal?: AbortSignal;
};

export const jobOperationContext = new AsyncLocalStorage<JobOperationContext>();
