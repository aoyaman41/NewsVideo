/**
 * 動画の書き出し・プレビューの進捗イベント(progress:update)。
 * 形は electron/ipc/video.ts の ProgressUpdatePayload(Main はすべてのウィンドウに送る)。
 */
export type VideoProgressEvent = {
  source?: string;
  /** 対象のプロジェクト */
  projectId?: string;
  /** job は自動生成ジョブの書き出し、manual は画面から依頼した書き出し・プレビュー */
  origin?: 'job' | 'manual';
  kind?: 'preview' | 'render';
  stage?: string;
  percent?: number;
  current?: number;
  total?: number;
  message?: string;
  error?: string;
};

/**
 * 動画画面の進捗表示に出してよいイベントか。開いているプロジェクトで、この画面が今行っている
 * 書き出し・プレビュー(画面から依頼したもの)だけを出す。別のプロジェクトのものや、
 * 自動生成ジョブの書き出し(画面上部の進捗表示で出す)は出さない。
 */
export function isOwnVideoProgress(
  payload: unknown,
  target: { projectId: string | undefined; kind: 'preview' | 'render' | null }
): payload is VideoProgressEvent {
  if (!payload || typeof payload !== 'object') return false;
  const event = payload as VideoProgressEvent;
  if (event.source !== 'video') return false;
  if (!target.projectId || !target.kind) return false;
  return (
    event.projectId === target.projectId && event.origin === 'manual' && event.kind === target.kind
  );
}
