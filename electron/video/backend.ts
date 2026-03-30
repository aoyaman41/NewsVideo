import { resolveFfmpegPath, type ResolveFfmpegPathOptions } from './ffmpeg';
import {
  resolveNativeVideoRendererBinary,
  type ResolveNativeVideoRendererOptions,
} from './native';

export const NATIVE_VIDEO_BACKEND_TRACKING_ISSUE_URL =
  'https://github.com/aoyaman41/NewsVideo/issues/62';

export type VideoBackendPreference = 'auto' | 'ffmpeg' | 'native';

export type ResolvedVideoBackend =
  | { id: 'ffmpeg'; ffmpegPath: string }
  | { id: 'native'; rendererPath: string };

type ResolveVideoBackendOptions = ResolveFfmpegPathOptions & {
  envValue?: string | undefined;
};

type ResolveVideoBackendDeps = {
  resolveFfmpegPath?: (options: ResolveFfmpegPathOptions) => Promise<string>;
  resolveNativeVideoRendererBinary?: (
    options: ResolveNativeVideoRendererOptions
  ) => Promise<string>;
};

export function parseVideoBackendPreference(input: string | undefined): VideoBackendPreference {
  const normalized = input?.trim().toLowerCase();
  if (normalized === 'ffmpeg') return 'ffmpeg';
  if (normalized === 'native') return 'native';
  return 'auto';
}

export async function resolveVideoBackend(
  options: ResolveVideoBackendOptions,
  deps: ResolveVideoBackendDeps = {}
): Promise<ResolvedVideoBackend> {
  const preference = parseVideoBackendPreference(options.envValue);
  const platform = options.platform ?? process.platform;
  const shouldUseNative = platform === 'darwin' && preference !== 'ffmpeg';

  if (preference === 'native' && platform !== 'darwin') {
    throw new Error('macOSネイティブ動画バックエンドは macOS でのみ選択できます。');
  }

  if (shouldUseNative) {
    const resolveNativeRenderer =
      deps.resolveNativeVideoRendererBinary ?? resolveNativeVideoRendererBinary;
    const rendererPath = await resolveNativeRenderer({
      isPackaged: options.isPackaged,
      resourcesPath: options.resourcesPath,
    });
    return { id: 'native', rendererPath };
  }

  const resolveFfmpeg = deps.resolveFfmpegPath ?? resolveFfmpegPath;
  const ffmpegPath = await resolveFfmpeg({
    isPackaged: options.isPackaged,
    platform,
    resourcesPath: options.resourcesPath,
  });
  return { id: 'ffmpeg', ffmpegPath };
}
