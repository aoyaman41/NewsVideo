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
/** 映像のビットレートの書き方(例: 8M、12M、7.5M、800k) */
export const VIDEO_BITRATE_PATTERN = /^\d+(?:\.\d+)?[kKmM]$/;

export function isVideoBitrate(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_BITRATE_PATTERN.test(value);
}

/** 映像のビットレートの決め方。auto は解像度と fps から決める。manual は保存した値を使う */
export const VIDEO_BITRATE_MODES = ['auto', 'manual'] as const;
export type VideoBitrateMode = (typeof VIDEO_BITRATE_MODES)[number];

/**
 * 解像度と fps から決める映像のビットレート(YouTube の推奨値。SDR のアップロード向け)。
 * 短い辺で段階を決める(縦長・正方形も同じ段階)。fps が 30 より大きいときは 60fps の値を使う。
 * - 2160: 30fps 35〜45Mbps → 40M / 60fps 53〜68Mbps → 60M
 * - 1440: 16M / 24M
 * - 1080: 8M / 12M
 * - 720 以下: 5M / 7.5M
 */
export function autoVideoBitrate(resolution: string, fps: number): string {
  const edges = resolution
    .split('x')
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const short = edges.length ? Math.min(...edges) : 1080;
  const high = Number.isFinite(fps) && fps > 30;
  if (short >= 2160) return high ? '60M' : '40M';
  if (short >= 1440) return high ? '24M' : '16M';
  if (short >= 1080) return high ? '12M' : '8M';
  return high ? '7.5M' : '5M';
}

/**
 * 書き出しに使う映像のビットレート。自動なら解像度と fps から決め、指定なら保存した値を使う
 * (保存した値が書き方に合わないときも自動で決める)。
 */
export function resolveVideoBitrate(
  mode: VideoBitrateMode,
  savedBitrate: string,
  resolution: string,
  fps: number
): string {
  if (mode === 'manual' && isVideoBitrate(savedBitrate)) return savedBitrate;
  return autoVideoBitrate(resolution, fps);
}

export const renderOptionsSchema = z.object({
  resolution: z.enum(VIDEO_RESOLUTIONS),
  fps: z.number().int().min(12).max(60),
  videoBitrate: z.string().regex(VIDEO_BITRATE_PATTERN),
  audioBitrate: z.string().regex(/^\d+[kKmM]$/),
  videoPartLeadInSec: z.number().min(0).max(5).optional(),
  openingVideoPath: z.string().optional(),
  endingVideoPath: z.string().optional(),
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
