import { useState } from 'react';
import type { Project, Part } from '../../schemas';
import { unmatchedTerms } from '../../../shared/project/provenance';
import { inputFingerprint } from '../../../shared/project/integrity';
import { Button, Card } from '../ui';

export function EvidenceReview({ project, part, onChange }: { project: Project; part: Part; onChange: (project: Project) => void }) {
  const [sourceId, setSourceId] = useState('');
  const sources = project.article.sources ?? [];
  const source = sources.find((item) => item.id === sourceId) ?? sources[0];
  const claims = part.claims ?? [];
  const currentInput = inputFingerprint({ text: part.scriptText, sources });
  const update = (id: string, changes: Partial<(typeof claims)[number]>) => onChange({ ...project, parts: project.parts.map((item) => item.id === part.id ? { ...item, claims: claims.map((claim) => claim.id === id ? { ...claim, ...changes } : claim) } : item) });
  const terms = unmatchedTerms(part.scriptText, source?.snapshot ?? project.article.bodyText);
  return <Card title="根拠と確認状態" subtitle="数値や名称の候補抽出は、事実確認の代わりにはなりません">
    <div className="space-y-3 text-sm">
      <select aria-label="照合する出典" className="nv-input" value={source?.id ?? ''} onChange={(e) => setSourceId(e.target.value)}><option value="">現在の記事本文</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.publisher || item.url || '原文スナップショット'}</option>)}</select>
      {terms.length > 0 && <p className="rounded bg-amber-50 p-2 text-amber-900">原文に同じ表記が見つからない数値・名称: {terms.join('、')}</p>}
      <Button size="sm" variant="secondary" onClick={() => onChange({ ...project, parts: project.parts.map((item) => item.id === part.id ? { ...item, claims: [...claims, { id: crypto.randomUUID(), text: part.scriptText, sourceId: source?.id, evidence: '', status: 'unverified', note: '' }] } : item) })}>この原稿に根拠を付ける</Button>
      {claims.map((claim) => <fieldset key={claim.id} className="space-y-2 rounded border p-3"><legend>主張と根拠</legend>
        <label className="block">確認する主張<textarea className="nv-input" rows={2} value={claim.text} onChange={(e) => update(claim.id, { text: e.target.value, status: 'unverified' })} /></label>
        <label className="block">根拠の原文抜粋<textarea className="nv-input" rows={2} value={claim.evidence} onChange={(e) => update(claim.id, { evidence: e.target.value, sourceId: source?.id, status: 'unverified' })} /></label>
        <details><summary className="cursor-pointer">根拠の原文を見る</summary><p className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{(() => { const original = sources.find((item) => item.id === claim.sourceId)?.snapshot ?? project.article.bodyText; const pos = claim.evidence ? original.indexOf(claim.evidence) : -1; return pos >= 0 ? <>{original.slice(Math.max(0, pos - 100), pos)}<mark>{claim.evidence}</mark>{original.slice(pos + claim.evidence.length, pos + claim.evidence.length + 200)}</> : original; })()}</p></details>
        <label className="block">編集者の確認<select className="nv-input" value={claim.checkedInput === currentInput ? claim.status : 'unverified'} onChange={(e) => update(claim.id, { status: e.target.value as typeof claim.status, checkedAt: new Date().toISOString(), checkedInput: currentInput })}><option value="unverified">未確認</option><option value="consistent">原文と整合（外部事実は未確認）</option><option value="externally_verified">外部事実を確認済み</option></select></label>
        <label className="block">確認方法・外部資料・確認者<input className="nv-input" value={claim.note} onChange={(e) => update(claim.id, { note: e.target.value })} /></label>
        {claim.checkedInput && claim.checkedInput !== currentInput && <p className="text-amber-800">原稿または出典が変更されたため再確認が必要です。</p>}
      </fieldset>)}
    </div>
  </Card>;
}
