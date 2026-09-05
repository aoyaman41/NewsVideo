import { expect, it } from 'vitest';
import { renderOptionsSchema, resolutionForAspect } from './videoFormat';

it('maps each quality tier consistently across preview, portrait, square and landscape', () => {
  expect(resolutionForAspect('1280x720', '9:16')).toBe('720x1280');
  expect(resolutionForAspect('1920x1080', '9:16')).toBe('1080x1920');
  expect(resolutionForAspect('3840x2160', '1:1')).toBe('2160x2160');
  expect(resolutionForAspect('1080x1080', '16:9')).toBe('1920x1080');
});

it('rejects unbounded dimensions, frame rates and malformed encoders settings', () => {
  const valid = {
    resolution: '1080x1920',
    fps: 30,
    videoBitrate: '8M',
    audioBitrate: '192k',
    includeOpening: false,
    includeEnding: false,
  };
  expect(renderOptionsSchema.safeParse(valid).success).toBe(true);
  expect(renderOptionsSchema.safeParse({ ...valid, resolution: '999999x999999' }).success).toBe(
    false
  );
  expect(renderOptionsSchema.safeParse({ ...valid, fps: 100000 }).success).toBe(false);
});
