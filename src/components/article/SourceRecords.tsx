import type { Project } from '../../schemas';
import { Button, Card } from '../ui';
export function SourceRecords({ project, onChange }: { project: Project; onChange: (project: Project) => void }) {
  const sources = project.article.sources ?? [];
  return <Card title="出典の記録" subtitle="原文を保存し、台本画面で主張と照合できます">
    <div className="space-y-3">
      <Button variant="secondary" size="sm" onClick={() => onChange({ ...project, article: { ...project.article, sources: [...sources, { id: crypto.randomUUID(), url: /^https?:/.test(project.article.source ?? '') ? project.article.source! : '', publisher: '', publishedAt: '', retrievedAt: new Date().toISOString(), snapshot: project.article.bodyText }] } })}>現在の原文を記録</Button>
      {sources.map((source) => <details key={source.id}><summary className="cursor-pointer text-sm">{source.publisher || source.url || '原文スナップショット'} · 取得 {new Date(source.retrievedAt).toLocaleString('ja-JP')}</summary><div className="space-y-2 pt-2">{(['url', 'publisher', 'publishedAt', 'snapshot'] as const).map((field) => <label key={field} className="block text-sm">{{ url: '記事URL', publisher: '媒体', publishedAt: '公開日', snapshot: '保存した原文' }[field]}<textarea rows={field === 'snapshot' ? 6 : 1} className="nv-input" value={source[field]} onChange={(e) => onChange({ ...project, article: { ...project.article, sources: sources.map((item) => item.id === source.id ? { ...item, [field]: e.target.value } : item) } })} /></label>)}</div></details>)}
    </div>
  </Card>;
}
