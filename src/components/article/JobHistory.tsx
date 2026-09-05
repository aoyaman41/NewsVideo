import { useState } from 'react';
import type { Project } from '../../schemas';
import { projectClient } from '../../stores/projectStore';
import { Button } from '../ui';
export function JobHistory({ project }: { project: Project }) {
  const [partId, setPartId] = useState(project.parts[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const outputs = [project.job, ...(project.jobHistory ?? [])].flatMap(
    (job) => job?.outputs.map((output, index) => ({ ...output, index, jobId: job.id })) ?? []
  );
  if (!outputs.length) return null;
  return (
    <details className="rounded border p-3 text-sm">
      <summary className="cursor-pointer">保存された生成結果（{outputs.length}件）</summary>
      <p className="my-2">
        入力変更や停止時にも結果を保持します。内容を確認して選択シーンへ割り当てると、画像または音声を置き換えます。
      </p>
      <select
        aria-label="履歴の素材を使うシーン"
        className="nv-input"
        value={partId}
        onChange={(e) => setPartId(e.target.value)}
      >
        {project.parts.map((part) => (
          <option key={part.id} value={part.id}>
            {part.index + 1}. {part.title}
          </option>
        ))}
      </select>
      <ul className="mt-2 space-y-2">
        {outputs.map((output) => (
          <li key={`${output.jobId}-${output.index}`} className="flex justify-between gap-2">
            <span>
              {output.step.startsWith('image:')
                ? '画像'
                : output.step.startsWith('audio:')
                  ? '音声'
                  : output.step === 'video'
                    ? '動画'
                    : '原稿・プロンプト'}{' '}
              · {new Date(output.createdAt).toLocaleTimeString('ja-JP')}
            </span>
            {/^(image|audio):/.test(output.step) && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!partId || project.job?.status === 'running'}
                onClick={async () => {
                  try {
                    await projectClient.flush(project.id);
                    await window.electronAPI.jobs.recoverAsset({
                      projectId: project.id,
                      index: output.index,
                      jobId: output.jobId,
                      partId,
                    });
                    setMessage('素材を割り当てました。シーン画面で内容を確認してください。');
                  } catch (error) {
                    setMessage(String(error));
                  }
                }}
              >
                この素材を使用
              </Button>
            )}
          </li>
        ))}
      </ul>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
