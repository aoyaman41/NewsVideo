import { expect, it } from 'vitest';
import {
  autoVideoBitrate,
  isVideoBitrate,
  renderOptionsSchema,
  resolutionForAspect,
  resolveVideoBitrate,
} from './videoFormat';

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

// M5: 映像のビットレートは解像度と fps から決める(YouTube の推奨値)
it('chooses the video bitrate from the resolution and the frame rate', () => {
  expect(autoVideoBitrate('1920x1080', 30)).toBe('8M');
  expect(autoVideoBitrate('1920x1080', 60)).toBe('12M');
  expect(autoVideoBitrate('1080x1920', 24)).toBe('8M');
  expect(autoVideoBitrate('3840x2160', 30)).toBe('40M');
  expect(autoVideoBitrate('2160x3840', 60)).toBe('60M');
  expect(autoVideoBitrate('2560x1440', 30)).toBe('16M');
  expect(autoVideoBitrate('1280x720', 30)).toBe('5M');
  expect(autoVideoBitrate('720x720', 60)).toBe('7.5M');
  for (const bitrate of ['8M', '12M', '40M', '60M', '7.5M'])
    expect(renderOptionsSchema.shape.videoBitrate.safeParse(bitrate).success).toBe(true);
});

it('uses a saved bitrate only when it is chosen explicitly and well-formed', () => {
  expect(resolveVideoBitrate('auto', '8M', '3840x2160', 60)).toBe('60M');
  expect(resolveVideoBitrate('manual', '8M', '3840x2160', 60)).toBe('8M');
  expect(resolveVideoBitrate('manual', 'fast', '1920x1080', 30)).toBe('8M');
  expect(isVideoBitrate('12M')).toBe(true);
  expect(isVideoBitrate('12 Mbps')).toBe(false);
});
