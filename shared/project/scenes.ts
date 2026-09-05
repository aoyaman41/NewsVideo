import { createNewPart, type Project } from './schema';

export function splitScene(project: Project, id: string, offset: number): Project {
  const index = project.parts.findIndex((part) => part.id === id);
  const part = project.parts[index];
  if (!part || offset <= 0 || offset >= part.scriptText.length)
    throw new Error('原稿の途中に分割位置を指定してください。');
  const left = part.scriptText.slice(0, offset).trim();
  const right = part.scriptText.slice(offset).trim();
  if (!left || !right) throw new Error('分割後の両方に原稿が必要です。');
  const now = new Date().toISOString();
  const second = {
    ...createNewPart(index + 1),
    title: `${part.title}（続き）`,
    scriptText: right,
    durationEstimateSec: right.length / 4,
    panelImages: [...part.panelImages],
    scriptModifiedByUser: true,
  };
  const parts = [...project.parts];
  parts.splice(
    index,
    1,
    {
      ...part,
      scriptText: left,
      audio: undefined,
      durationEstimateSec: left.length / 4,
      updatedAt: now,
      scriptModifiedByUser: true,
    },
    second
  );
  return { ...project, parts: parts.map((item, i) => ({ ...item, index: i })) };
}

export function mergeSceneWithNext(project: Project, id: string): Project {
  const index = project.parts.findIndex((part) => part.id === id);
  const first = project.parts[index];
  const second = project.parts[index + 1];
  if (!first || !second) throw new Error('結合する次のシーンがありません。');
  const parts = [...project.parts];
  parts.splice(index, 2, {
    ...first,
    scriptText: `${first.scriptText}\n${second.scriptText}`,
    summary: [first.summary, second.summary].filter(Boolean).join('\n'),
    panelImages: [...first.panelImages, ...second.panelImages],
    comments: [...first.comments, ...second.comments],
    audio: undefined,
    durationEstimateSec: first.durationEstimateSec + second.durationEstimateSec,
    updatedAt: new Date().toISOString(),
    scriptModifiedByUser: true,
  });
  return { ...project, parts: parts.map((part, i) => ({ ...part, index: i })) };
}
