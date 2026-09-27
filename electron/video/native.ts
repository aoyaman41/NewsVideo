import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { VideoJob } from './ffmpeg';
import {
  DEFAULT_STALL_TIMEOUT_MS,
  createProgressObserver,
  createStallWatchdog,
  stallErrorMessage,
} from './watchdog';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_PROJECT_ROOT_MARKERS = [
  path.join('native', 'video-renderer', 'NativeVideoRenderer.swift'),
  'package.json',
] as const;

type ProgressHandler = (progress: Record<string, string>) => void;

export type ResolveNativeVideoRendererOptions = {
  isPackaged: boolean;
  resourcesPath?: string;
};

export type NativeRenderPartRequest = {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: string;
  audioBitrate: string;
  audioPath: string;
  audioDelayMs: number;
  imageEntries: Array<{ filePath: string; durationSec: number }>;
  captions?: Array<{ start: number; end: number; text: string }>;
  graphic?: import('../../shared/project/schema').Part['graphic'];
};

export type NativeNormalizeClipRequest = {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: string;
  audioBitrate: string;
};

export type NativeConcatSegmentsRequest = {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: string;
  audioBitrate: string;
  segmentPaths: string[];
};

export type NativeRenderClosingCardRequest = {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: string;
  /** ほかの区間と同じ形式の無音トラックを付けるためのビットレート */
  audioBitrate: string;
  durationSec: number;
  headline?: string;
  cta?: string;
  source?: string;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDevProjectRoot(candidate: string): Promise<boolean> {
  const checks = await Promise.all(
    DEV_PROJECT_ROOT_MARKERS.map((marker) => fileExists(path.join(candidate, marker)))
  );
  return checks.every(Boolean);
}

async function resolveDevProjectRoot(): Promise<string> {
  const candidates = [
    process.cwd(),
    __dirname,
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
    path.resolve(__dirname, '../../..'),
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (await isDevProjectRoot(normalized)) {
      return normalized;
    }
  }

  throw new Error(
    '開発用 native-video-renderer のプロジェクトルートを特定できませんでした。NewsVideo リポジトリ直下から起動してください。'
  );
}

async function getDevBinaryPath(): Promise<string> {
  const projectRoot = await resolveDevProjectRoot();
  return path.join(projectRoot, 'resources', 'native-video-renderer', 'native-video-renderer');
}

async function getDevSourcePath(): Promise<string> {
  const projectRoot = await resolveDevProjectRoot();
  return path.join(projectRoot, 'native', 'video-renderer', 'NativeVideoRenderer.swift');
}

async function ensureNativeBinaryBuilt(binaryPath: string): Promise<void> {
  const sourcePath = await getDevSourcePath();
  const [sourceStat, binaryStat] = await Promise.allSettled([
    fs.stat(sourcePath),
    fs.stat(binaryPath),
  ]);
  const needsBuild =
    binaryStat.status === 'rejected' ||
    (sourceStat.status === 'fulfilled' &&
      binaryStat.status === 'fulfilled' &&
      sourceStat.value.mtimeMs > binaryStat.value.mtimeMs);

  if (!needsBuild) {
    return;
  }

  await fs.mkdir(path.dirname(binaryPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'xcrun',
      [
        'swiftc',
        '-parse-as-library',
        '-O',
        '-o',
        binaryPath,
        sourcePath,
        '-framework',
        'AVFoundation',
        '-framework',
        'AppKit',
        '-framework',
        'CoreGraphics',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
    });
    proc.stdout.on('data', () => {
      // ignore
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `swiftc exited with code ${code ?? 'null'}`));
      }
    });
  });

  await fs.chmod(binaryPath, 0o755);
}

export async function resolveNativeVideoRendererBinary(
  options: ResolveNativeVideoRendererOptions
): Promise<string> {
  if (options.isPackaged) {
    const resourcesPath = options.resourcesPath ?? process.resourcesPath;
    const packagedPath = path.join(resourcesPath, 'native-video-renderer', 'native-video-renderer');
    if (!(await fileExists(packagedPath))) {
      throw new Error(
        'macOSネイティブ動画レンダラーが見つかりません。アプリを再インストールしてください。'
      );
    }
    return packagedPath;
  }

  const binaryPath = await getDevBinaryPath();
  await ensureNativeBinaryBuilt(binaryPath);
  return binaryPath;
}

async function runNativeTool(
  binaryPath: string,
  command: string,
  request: object,
  job: VideoJob,
  onProgress?: ProgressHandler
): Promise<void> {
  if (job.canceled) {
    throw new Error('キャンセルしました');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-native-video-'));
  const requestPath = path.join(tempDir, `${command}.json`);
  await fs.writeFile(requestPath, JSON.stringify(request, null, 2), 'utf-8');

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(binaryPath, [command, requestPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      job.processes.add(proc);

      let stdoutBuffer = '';
      let stderr = '';
      // レンダラーは映像 0.5 秒ごと(連結は 0.2 秒ごと)に進捗を出す。出力が止まったら固まったとみなして止める
      let stalled = false;
      const stallTimeoutMs = job.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
      const watchdog = createStallWatchdog(stallTimeoutMs, () => {
        stalled = true;
        proc.kill('SIGKILL');
        // 子プロセスが出力をつかんだままでも待たずに失敗させる
        cleanup();
        reject(new Error(stallErrorMessage(stallTimeoutMs, command)));
      });

      const cleanup = () => {
        watchdog.stop();
        job.processes.delete(proc);
      };

      const advanced = createProgressObserver();
      proc.stdout.on('data', (data) => {
        stdoutBuffer += data.toString('utf-8');
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const index = trimmed.indexOf('=');
          if (index <= 0) continue;
          const key = trimmed.slice(0, index);
          const value = trimmed.slice(index + 1);
          if (advanced(key, value)) watchdog.reset();
          onProgress?.({ [key]: value });
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString('utf-8');
        if (stderr.length > 5000) stderr = stderr.slice(-5000);
      });

      proc.on('error', (error) => {
        cleanup();
        reject(error);
      });

      proc.on('close', (code, signal) => {
        cleanup();
        if (job.canceled) {
          reject(new Error('キャンセルしました'));
          return;
        }
        if (stalled) {
          reject(new Error(stallErrorMessage(stallTimeoutMs, command)));
          return;
        }
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `native-video-renderer エラー (code=${code ?? 'null'}, signal=${signal ?? 'null'}): ${stderr.trim()}`
            )
          );
        }
      });
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function renderPartVideoNative(
  binaryPath: string,
  request: NativeRenderPartRequest,
  job: VideoJob,
  onProgress?: ProgressHandler
): Promise<void> {
  await runNativeTool(binaryPath, 'render-part', request, job, onProgress);
}

export async function normalizeVideoClipNative(
  binaryPath: string,
  request: NativeNormalizeClipRequest,
  job: VideoJob,
  onProgress?: ProgressHandler
): Promise<void> {
  await runNativeTool(binaryPath, 'normalize-clip', request, job, onProgress);
}

/**
 * 区間をつなぐ。すべての区間が同じ形式なら再エンコードせずにつなぐ(mode: passthrough)。
 * 形式が違う区間があるときは、指定の設定で書き出し直す(mode: reencode)
 */
export async function concatSegmentsNative(
  binaryPath: string,
  request: NativeConcatSegmentsRequest,
  job: VideoJob,
  onProgress?: ProgressHandler
): Promise<{ mode: 'passthrough' | 'reencode' | 'unknown' }> {
  let mode: 'passthrough' | 'reencode' | 'unknown' = 'unknown';
  await runNativeTool(binaryPath, 'concat-segments', request, job, (record) => {
    if (record.concat_mode === 'passthrough' || record.concat_mode === 'reencode')
      mode = record.concat_mode;
    onProgress?.(record);
  });
  return { mode };
}

export async function renderClosingCardVideoNative(
  binaryPath: string,
  request: NativeRenderClosingCardRequest,
  job: VideoJob,
  onProgress?: ProgressHandler
): Promise<void> {
  await runNativeTool(binaryPath, 'render-closing-card', request, job, onProgress);
}

export async function probeDurationNative(binaryPath: string, inputPath: string) {
  let duration = 0;
  await runNativeTool(
    binaryPath,
    'probe',
    { inputPath },
    { canceled: false, processes: new Set() },
    (record) => {
      if (record.duration) duration = Number(record.duration);
    }
  );
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('動画の長さを読み込めません。');
  return duration;
}
