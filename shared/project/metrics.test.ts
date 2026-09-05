import { expect, it } from 'vitest';
import { createNewProject } from './schema';
import { diagnosticProject, productionMetrics } from './metrics';
it('keeps unavailable timings distinct from zero and allowlists diagnostics', () => {
  const project = createNewProject('PRIVATE NAME', '/private/path');
  project.article.bodyText = 'PRIVATE ARTICLE'; project.article.source = 'PRIVATE SOURCE';
  expect(productionMetrics(project).elapsedToOutputSec).toBeNull();
  const serialized = JSON.stringify(diagnosticProject(project));
  expect(serialized).not.toContain('PRIVATE'); expect(serialized).not.toContain('/private/path');
});
