import { z } from 'zod';
import type { ImageAspectRatio } from './imageStylePresets';

export const VIDEO_RESOLUTIONS = [
  '1280x720',
  '1920x1080',
  '3840x2160',
  '720x1280',
  '1080x1920',
  '2160x3840',
  '720x720',
  '1080x1080',
  '2160x2160',
] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export const renderOptionsSchema = z.object({
  resolution: z.enum(VIDEO_RESOLUTIONS),
  fps: z.number().int().min(12).max(60),
  videoBitrate: z.string().regex(/^\d+(?:\.\d+)?[kKmM]$/),
  audioBitrate: z.string().regex(/^\d+[kKmM]$/),
  includeOpening: z.boolean(),
  includeEnding: z.boolean(),
});
export type RenderOptions = z.infer<typeof renderOptionsSchema>;

export function resolutionForAspect(base: string, ratio: ImageAspectRatio): VideoResolution {
  const dimensions = base.split('x').map(Number);
  const short = Math.min(...dimensions);
  const level = short >= 2160 ? 2 : short >= 1080 ? 1 : 0;
  return (
    {
      '16:9': ['1280x720', '1920x1080', '3840x2160'],
      '9:16': ['720x1280', '1080x1920', '2160x3840'],
      '1:1': ['720x720', '1080x1080', '2160x2160'],
    } as const
  )[ratio][level];
}
