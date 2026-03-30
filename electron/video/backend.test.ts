import { describe, expect, it, vi } from 'vitest';
import {
  parseVideoBackendPreference,
  resolveVideoBackend,
} from './backend';

describe('video backend selection', () => {
  it('defaults to auto and resolves ffmpeg when env is missing', async () => {
    const resolveFfmpegPath = vi.fn().mockResolvedValue('/tmp/ffmpeg');
    const resolveNativeVideoRendererBinary = vi.fn().mockResolvedValue('/tmp/native-video-renderer');

    const backend = await resolveVideoBackend(
      {
        envValue: undefined,
        platform: 'linux',
        isPackaged: true,
        resourcesPath: '/Applications/NewsVideo.app/Contents/Resources',
      },
      { resolveFfmpegPath, resolveNativeVideoRendererBinary }
    );

    expect(parseVideoBackendPreference(undefined)).toBe('auto');
    expect(backend).toEqual({ id: 'ffmpeg', ffmpegPath: '/tmp/ffmpeg' });
    expect(resolveFfmpegPath).toHaveBeenCalledWith({
      isPackaged: true,
      platform: 'linux',
      resourcesPath: '/Applications/NewsVideo.app/Contents/Resources',
    });
    expect(resolveNativeVideoRendererBinary).not.toHaveBeenCalled();
  });

  it('returns native when explicitly requested on macOS', async () => {
    const resolveFfmpegPath = vi.fn();
    const resolveNativeVideoRendererBinary = vi.fn().mockResolvedValue('/tmp/native-video-renderer');

    const backend = await resolveVideoBackend(
      {
        envValue: 'native',
        platform: 'darwin',
        isPackaged: true,
        resourcesPath: '/Applications/NewsVideo.app/Contents/Resources',
      },
      { resolveFfmpegPath, resolveNativeVideoRendererBinary }
    );

    expect(backend).toEqual({ id: 'native', rendererPath: '/tmp/native-video-renderer' });
    expect(resolveFfmpegPath).not.toHaveBeenCalled();
    expect(resolveNativeVideoRendererBinary).toHaveBeenCalledWith({
      isPackaged: true,
      resourcesPath: '/Applications/NewsVideo.app/Contents/Resources',
    });
  });

  it('uses native by default on macOS when auto is selected', async () => {
    const resolveFfmpegPath = vi.fn().mockResolvedValue('/tmp/ffmpeg');
    const resolveNativeVideoRendererBinary = vi.fn().mockResolvedValue('/tmp/native-video-renderer');

    const backend = await resolveVideoBackend(
      {
        envValue: 'something-else',
        platform: 'darwin',
        isPackaged: false,
        resourcesPath: '/tmp/resources',
      },
      { resolveFfmpegPath, resolveNativeVideoRendererBinary }
    );

    expect(parseVideoBackendPreference('something-else')).toBe('auto');
    expect(backend).toEqual({ id: 'native', rendererPath: '/tmp/native-video-renderer' });
    expect(resolveFfmpegPath).not.toHaveBeenCalled();
  });

  it('rejects native on non-macOS platforms', async () => {
    await expect(
      resolveVideoBackend({
        envValue: 'native',
        platform: 'linux',
        isPackaged: false,
        resourcesPath: '/tmp/resources',
      })
    ).rejects.toThrow('macOS');
  });
});
