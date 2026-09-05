import { useState } from 'react';
import type { Project, Part } from '../../schemas';
import { splitScene, mergeSceneWithNext } from '../../../shared/project/scenes';
import { toLocalFileUrl } from '../../utils/toLocalFileUrl';
import { Button, Card } from '../ui';
import { projectClient } from '../../stores/projectStore';

export function SceneStudio({ project, part, onChange }: { project: Project; part: Part; onChange: (project: Project) => void }) {
  const [offset, setOffset] = useState(Math.max(1, Math.floor(part.scriptText.length / 2)));
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const images = [...project.images, ...project.article.importedImages];
  const update = (changes: Partial<Part>) => onChange({ ...project, parts: project.parts.map((item) => item.id === part.id ? { ...item, ...changes } : item) });
  const run = (action: () => Project) => { try { onChange(action()); setPreview(''); setError(''); } catch (failure) { setError(String(failure)); } };
  const renderPreview = async () => {
    setBusy(true); setError('');
    try {
      await projectClient.flush(project.id);
      const result = await window.electronAPI.video.preview(part.id);
      setPreview(result.previewPath);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  return <Card title="シーンの映像とカット" subtitle="原稿の下で素材と時間を調整できます">
    <div className="space-y-3">
      {preview ? <video controls src={toLocalFileUrl(preview)} className="max-h-80 w-full bg-black" /> : part.panelImages[0] && <img src={toLocalFileUrl(images.find((image) => image.id === part.panelImages[0].imageId)?.filePath ?? '')} alt="選択シーンの先頭カット" className="max-h-64 w-full object-contain bg-slate-950" />}
      {part.audio && <audio aria-label="このシーンのナレーション" controls src={toLocalFileUrl(part.audio.filePath)} className="w-full" />}
      <Button size="sm" variant="secondary" disabled={busy || !part.audio || !part.panelImages.length} onClick={() => void renderPreview()}>{busy ? 'プレビュー作成中…' : '映像プレビューを更新'}</Button>
      <div className="flex gap-1 overflow-auto" aria-label="カットのタイムライン">
        {part.panelImages.map((ref, i) => <div key={`${ref.imageId}-${i}`} className="min-w-32 flex-1 rounded border p-2" style={{ flexGrow: ref.displayDurationSec ?? 1 }}>
          <div className="text-xs">カット {i + 1}</div>
          <select aria-label={`カット${i + 1}の画像`} className="nv-input" value={ref.imageId} onChange={(e) => update({ panelImages: part.panelImages.map((item, n) => n === i ? { ...item, imageId: e.target.value } : item) })}>{images.map((image, n) => <option key={image.id} value={image.id}>画像 {n + 1} · {image.sourceType === 'generated' ? '生成' : '取込'}</option>)}</select>
          <label className="text-xs">表示秒数（空欄は自動）<input type="number" min="0.1" step="0.1" className="nv-input" value={ref.displayDurationSec ?? ''} onChange={(e) => update({ panelImages: part.panelImages.map((item, n) => n === i ? { ...item, displayDurationSec: Number(e.target.value) > 0 ? Number(e.target.value) : undefined } : item) })} /></label>
          <Button variant="ghost" size="sm" onClick={() => update({ panelImages: part.panelImages.filter((_, n) => n !== i) })}>カットを外す</Button>
        </div>)}
      </div>
      {images.length > 0 && <Button size="sm" variant="secondary" onClick={() => update({ panelImages: [...part.panelImages, { imageId: images[0].id }] })}>カットを追加</Button>}
      <p className="text-xs text-slate-600">音声尺 {part.audio ? `${part.audio.durationSec.toFixed(1)}秒` : '未生成'}。カットの指定秒数は音声全体の尺に合わせて配分されます。</p>
      <details><summary className="cursor-pointer text-sm">シーンの分割・結合</summary><div className="mt-2 space-y-2">
        <label className="text-sm">分割位置（文字数）<input type="number" className="nv-input" min="1" max={part.scriptText.length - 1} value={offset} onChange={(e) => setOffset(Number(e.target.value))} /></label>
        <p className="text-xs">…{part.scriptText.slice(Math.max(0, offset - 20), offset)} <strong>｜分割｜</strong> {part.scriptText.slice(offset, offset + 20)}…</p>
        <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => run(() => splitScene(project, part.id, offset))}>ここで分割</Button><Button size="sm" variant="secondary" disabled={part.index >= project.parts.length - 1} onClick={() => run(() => mergeSceneWithNext(project, part.id))}>次のシーンと結合</Button></div>
        <p className="text-xs text-slate-600">音声は変更後の原稿で再生成が必要です。元の音声ファイルは保持されます。</p>
      </div></details>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </Card>;
}
