import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export type VideoJob = {
  canceled: boolean;
  processes: Set<ReturnType<typeof spawn>>;
};

type ProgressHandler = (progress: Record<string, string>) => void;

export type ResolveFfmpegPathOptions = {
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getFfmpegCandidatePaths(options: ResolveFfmpegPathOptions): string[] {
  const platform = options.platform ?? process.platform;
  const bin = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates: string[] = [];

  if (options.isPackaged) {
    const resourcesPath = options.resourcesPath ?? process.resourcesPath;
    candidates.push(path.join(resourcesPath, 'ffmpeg', bin));
    candidates.push(path.join(resourcesPath, 'ffmpeg', 'bin', bin));
  }

  candidates.push(bin);
  return candidates;
}

export async function resolveFfmpegPath(options: ResolveFfmpegPathOptions): Promise<string> {
  if (!options.isPackaged) {
    try {
      const ffmpegStaticPath = require('ffmpeg-static') as string;
      if (ffmpegStaticPath && (await fileExists(ffmpegStaticPath))) return ffmpegStaticPath;
    } catch {
      // ignore and fallback to PATH
    }
  }

  const candidates = getFfmpegCandidatePaths(options);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (await fileExists(candidate)) return candidate;
      continue;
    }

    // PATH 上のコマンドは存在確認できないので、そのまま spawn に渡す
    return candidate;
  }

  throw new Error(
    'ffmpegが見つかりません（アプリに同梱されていない可能性があります）。再インストールしてください。'
  );
}

export async function probeHasAudio(ffmpegPath: string, inputPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
    });
    proc.on('close', () => {
      resolve(/Audio:\s/.test(stderr));
    });
    proc.on('error', () => resolve(false));
  });
}

export async function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  job: VideoJob,
  onProgress?: ProgressHandler,
  options: { isPackaged?: boolean } = {}
): Promise<void> {
  if (job.canceled) {
    throw new Error('キャンセルしました');
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    job.processes.add(proc);

    let stderr = '';
    let stdoutBuf = '';

    const cleanup = () => {
      job.processes.delete(proc);
    };

    proc.stdout.on('data', (data) => {
      stdoutBuf += data.toString('utf-8');
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx);
        const value = trimmed.slice(idx + 1);
        onProgress?.({ [key]: value });
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
      if (stderr.length > 5000) stderr = stderr.slice(-5000);
    });

    proc.on('error', (err) => {
      cleanup();
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const message = options.isPackaged
          ? 'ffmpegが見つかりません（アプリに同梱されていない可能性があります）。再インストールしてください。'
          : 'ffmpegが見つかりません。`npm i -D ffmpeg-static` または Homebrew で `brew install ffmpeg` を実行してください。';
        reject(new Error(message));
        return;
      }
      reject(err);
    });

    proc.on('close', (code, signal) => {
      cleanup();
      if (job.canceled) {
        reject(new Error('キャンセルしました'));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `ffmpegエラー (code=${code ?? 'null'}, signal=${signal ?? 'null'}): ${stderr.trim()}`
          )
        );
      }
    });
  });
}
