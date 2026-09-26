import { describe, expect, it } from 'vitest';
import { isOwnVideoProgress } from './videoProgress';

const event = (overrides: Record<string, unknown> = {}) => ({
  source: 'video',
  projectId: 'project-a',
  origin: 'manual',
  kind: 'render',
  stage: 'rendering_parts',
  percent: 40,
  ...overrides,
});

describe('isOwnVideoProgress', () => {
  const rendering = { projectId: 'project-a', kind: 'render' as const };

  it('shows the export this screen started for the open project', () => {
    expect(isOwnVideoProgress(event(), rendering)).toBe(true);
    expect(
      isOwnVideoProgress(event({ kind: 'preview' }), { projectId: 'project-a', kind: 'preview' })
    ).toBe(true);
  });

  it('ignores the progress of another project', () => {
    expect(isOwnVideoProgress(event({ projectId: 'project-b' }), rendering)).toBe(false);
    expect(isOwnVideoProgress(event({ projectId: undefined }), rendering)).toBe(false);
  });

  it('ignores exports made by an auto generation job (shown in the top banner)', () => {
    expect(isOwnVideoProgress(event({ origin: 'job' }), rendering)).toBe(false);
    expect(isOwnVideoProgress(event({ origin: 'job', projectId: 'project-b' }), rendering)).toBe(
      false
    );
  });

  it('ignores a preview while exporting, and anything while idle', () => {
    expect(isOwnVideoProgress(event({ kind: 'preview' }), rendering)).toBe(false);
    expect(isOwnVideoProgress(event(), { projectId: 'project-a', kind: null })).toBe(false);
    expect(isOwnVideoProgress(event(), { projectId: undefined, kind: 'render' })).toBe(false);
  });

  it('ignores other sources and malformed payloads', () => {
    expect(isOwnVideoProgress(event({ source: 'image' }), rendering)).toBe(false);
    expect(isOwnVideoProgress(null, rendering)).toBe(false);
    expect(isOwnVideoProgress('video', rendering)).toBe(false);
  });
});
