import type { Project, Part } from '../../schemas';
import { Card } from '../ui';
export function AssetRights({ project, part, onChange }: { project: Project; part: Part; onChange: (project: Project) => void }) {
  const images = [...project.images, ...project.article.importedImages].filter((image) => part.panelImages.some((ref) => ref.imageId === image.id));
  return <Card title="素材の由来と利用条件"><div className="space-y-3">{images.length === 0 && <p className="text-sm">画像を割り当てると記録できます。</p>}{images.map((image, i) => {
    const rights = image.rights ?? { origin: image.sourceType === 'generated' ? 'generated' : 'reused', terms: '', attribution: '' };
    const update = (changes: Partial<typeof rights>) => { const replace = (item: typeof image) => item.id === image.id ? { ...item, rights: { ...rights, ...changes } } : item; onChange({ ...project, images: project.images.map(replace), article: { ...project.article, importedImages: project.article.importedImages.map(replace) } }); };
    return <fieldset key={image.id} className="space-y-2 text-sm"><legend>画像 {i + 1}</legend><label className="block">由来<select className="nv-input" value={rights.origin} onChange={(e) => update({ origin: e.target.value as typeof rights.origin })}><option value="generated">AI生成</option><option value="shot">自分で撮影・制作</option><option value="reused">転載・提供</option></select></label><label className="block">利用条件<textarea className="nv-input" rows={2} value={rights.terms} onChange={(e) => update({ terms: e.target.value })} /></label><label className="block">クレジット・権利者<input className="nv-input" value={rights.attribution} onChange={(e) => update({ attribution: e.target.value })} /></label></fieldset>;
  })}</div></Card>;
}
