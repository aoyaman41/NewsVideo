import { isRenderConflictError } from '../../shared/project/renderIntent';
import { projectClient } from '../stores/projectStore';

/**
 * 書き出し・プレビューが「内容が変更された」競合で失敗したとき、画面側に未保存の変更がなければ
 * 保存済みの最新を読み直して 1 回だけ再試行する。未保存の変更があるときは再試行せずにエラーを返す。
 * attempt は呼ばれるたびに、ストアから最新の保持データを読み直して組み立てること。
 * 再試行のとき(isRetry = true)は、画面だけが持つ値(ストア外の未保存の編集)が読み直した内容と
 * 食い違っていないかを attempt 側で確かめ、食い違えば競合エラーを投げて止めること。
 */
export async function withRenderConflictRetry<T>(
  projectId: string,
  attempt: (isRetry: boolean) => Promise<T>
): Promise<T> {
  try {
    return await attempt(false);
  } catch (error) {
    if (!isRenderConflictError(error) || !(await projectClient.reloadIfClean(projectId)))
      throw error;
    return attempt(true);
  }
}
