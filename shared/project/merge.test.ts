import { expect, it } from 'vitest';
import { createNewPart, createNewProject } from './schema';
import { mergeProjectDraft } from './merge';

it('merges disjoint scene edits and preserves a newer Main job update', () => {
  const base = createNewProject('Base', '/tmp');
  base.parts = [createNewPart(0), createNewPart(1)];
  const local = structuredClone(base);
  local.parts[0].scriptText = 'User edit';
  const remote = structuredClone(base);
  remote.parts[1].title = 'Generated';
  remote.revision = 4;
  const merged = mergeProjectDraft(base, local, remote);
  expect(merged.conflicts).toEqual([]);
  expect(merged.project.parts[0].scriptText).toBe('User edit');
  expect(merged.project.parts[1].title).toBe('Generated');
  expect(merged.project.revision).toBe(4);
});

it('keeps the local text and identifies overlapping edits without silently choosing a winner', () => {
  const base = createNewProject('Base', '/tmp');
  const local = structuredClone(base);
  local.article.bodyText = 'User edit';
  const remote = structuredClone(base);
  remote.article.bodyText = 'Other edit';
  expect(mergeProjectDraft(base, local, remote)).toMatchObject({
    project: { article: { bodyText: 'User edit' } },
    conflicts: ['project.article.bodyText'],
  });
});
