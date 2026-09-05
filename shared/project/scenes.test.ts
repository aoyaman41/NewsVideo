import { expect, it } from 'vitest';
import { createNewPart, createNewProject } from './schema';
import { splitScene, mergeSceneWithNext } from './scenes';
import { unmatchedTerms } from './provenance';
it('splits without losing text or deleting retained assets and merges in order', () => {
  const project = createNewProject('test', '/tmp');
  project.parts = [createNewPart(0, { scriptText: '前半。後半。' })];
  const split = splitScene(project, project.parts[0].id, 3);
  expect(split.parts.map((part) => part.scriptText)).toEqual(['前半。', '後半。']);
  expect(new Set(split.parts.map((part) => part.id)).size).toBe(2);
  expect(mergeSceneWithNext(split, split.parts[0].id).parts[0].scriptText).toBe('前半。\n後半。');
  expect(project.parts).toHaveLength(1);
  expect(() => splitScene(project, project.parts[0].id, 0)).toThrow();
});
it('flags unmatched quantities as review candidates', () => {
  expect(unmatchedTerms('OpenAIは2026年に20億円と発表', 'OpenAIは2026年に10億円')).toContain('20億');
  expect(unmatchedTerms('OpenAIは2026年', 'OpenAIは2026年')).toEqual([]);
});
