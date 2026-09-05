import type { Part, Project } from '../../schemas';
import { approveAssets, partFreshness } from '../../../shared/project/integrity';

export function AssetReview({
  project,
  part,
  onChange,
}: {
  project: Project;
  part: Part;
  onChange: (project: Project) => void;
}) {
  const states = partFreshness(project, part);
  const labels = { script: '台本と記事', image: '画像と台本', audio: '音声と原稿' };
  return (
    <section
      className="space-y-2 rounded border border-slate-200 bg-white p-3"
      aria-label="素材の更新状態"
    >
      <h3 className="text-sm font-semibold">素材の更新状態</h3>
      {(['script', 'image', 'audio'] as const).map((kind) => (
        <div key={kind} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            {labels[kind]}：
            {states[kind] === 'current'
              ? '最新'
              : states[kind] === 'missing'
                ? '未生成・ファイルなし'
                : '更新が必要'}
          </span>
          {states[kind] === 'stale' && (
            <button
              className="rounded border px-2 py-1"
              onClick={() => onChange(approveAssets(project, part.id, [kind]))}
            >
              内容を確認して維持
            </button>
          )}
        </div>
      ))}
      <p className="text-xs text-slate-600">
        変更後も使える素材は、内容を確認して維持できます。音声画面の未生成分生成は更新が必要なパートも対象です。
      </p>
    </section>
  );
}
