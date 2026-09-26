import type { Project } from '../../schemas';
import { projectClient } from '../../stores/projectStore';
import { refreshEnabledCaptions } from './captionSync';

/**
 * プレビューの前に、画面の編集を保存し、字幕が ON のシーンの字幕を最新にしてから、保存済みの内容を返す。
 * Main 側はこの内容が保存済みの最新と一致するかを確かめてから動画を作る。
 */
export async function loadForPreview(projectId: string): Promise<Project> {
  await projectClient.flush(projectId);
  const intended = await projectClient.load(projectId);
  const refreshed = refreshEnabledCaptions(intended);
  if (!refreshed) return intended;
  await projectClient.save(refreshed);
  return projectClient.load(projectId);
}
