import { BrowserWindow, app, ipcMain } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';

type RenderStage = 'preparing' | 'rendering_parts' | 'concatenating' | 'finalizing';

interface ProgressUpdatePayload {
  source: 'video';
  stage?: RenderStage;
  percent?: number;
  current?: number;
  total?: number;
  message?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

type RenderOptions = {
  resolution: '1920x1080' | '1280x720' | '3840x2160';
  fps: number;
  videoBitrate: string;
  audioBitrate: string;
  includeOpening: boolean;
  includeEnding: boolean;
};

type Settings = {
  openingVideoPath?: string;
  endingVideoPath?: string;
};

type ImageAssetLike = { id: string; filePath: string };
type AudioAssetLike = { id: string; filePath: string; durationSec: number };
type ImageAssetRefLike = { imageId: string; displayDurationSec?: number };
type PartLike = {
  id: string;
  index: number;
  title: string;
  panelImages: ImageAssetRefLike[];
  audio?: AudioAssetLike;
};
type ProjectLike = {
  id: string;
  name: string;
  path: string;
  parts: PartLike[];
  images: ImageAssetLike[];
  audio: AudioAssetLike[];
  article: { importedImages: ImageAssetLike[] };
};

type VideoJob = {
  canceled: boolean;
  processes: Set<ReturnType<typeof spawn>>;
};

let currentJob: VideoJob | null = null;
const require = createRequire(import.meta.url);

function sendProgress(payload: Omit<ProgressUpdatePayload, 'source'>) {
  const full: ProgressUpdatePayload = { source: 'video', ...payload };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('progress:update', full);
  }
}

function parseResolution(resolution: RenderOptions['resolution']): { width: number; height: number } {
  const [w, h] = resolution.split('x').map((v) => Number(v));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(`Invalid resolution: ${resolution}`);
  }
  return { width: w, height: h };
}

function buildScalePadFilter(width: number, height: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'format=yuv420p',
  ].join(',');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertNotCanceled(job: VideoJob) {
  if (job.canceled) {
    throw new Error('キャンセルしました');
  }
}

async function readSettings(): Promise<Settings> {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(content) as Settings;
    return {
      openingVideoPath: typeof parsed.openingVideoPath === 'string' ? parsed.openingVideoPath : undefined,
      endingVideoPath: typeof parsed.endingVideoPath === 'string' ? parsed.endingVideoPath : undefined,
    };
  } catch {
    return {};
  }
}

function getFfmpegCandidatePaths(): string[] {
  const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates: string[] = [];

  // packaged: resources/ffmpeg/** に同梱される想定
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'ffmpeg', bin));
    candidates.push(path.join(process.resourcesPath, 'ffmpeg', 'bin', bin));
    return candidates;
  }

  // dev: PATH の ffmpeg
  candidates.push(bin);

  return candidates;
}

async function resolveFfmpegPath(): Promise<string> {
  // dev: まずは ffmpeg-static を優先（brew不要）
  if (!app.isPackaged) {
    try {
      const ffmpegStaticPath = require('ffmpeg-static') as string;
      if (ffmpegStaticPath && (await fileExists(ffmpegStaticPath))) return ffmpegStaticPath;
    } catch {
      // ignore and fallback to PATH
    }
  }

  const candidates = getFfmpegCandidatePaths();
  for (const p of candidates) {
    if (p.includes(path.sep)) {
      if (await fileExists(p)) return p;
      continue;
    }
    // PATH上のコマンドは存在確認できないのでそのまま返す（spawnで失敗したらハンドリング）
    return p;
  }
  throw new Error(
    'ffmpegが見つかりません（アプリに同梱されていない可能性があります）。再インストールしてください。'
  );
}

async function probeHasAudio(ffmpegPath: string, inputPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString('utf-8');
    });
    proc.on('close', () => {
      resolve(/Audio:\s/.test(stderr));
    });
    proc.on('error', () => resolve(false));
  });
}

async function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  job: VideoJob,
  onProgress?: (progress: Record<string, string>) => void
): Promise<void> {
  assertNotCanceled(job);

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
      // でかくなりすぎないように最後の方だけ保持
      if (stderr.length > 5000) stderr = stderr.slice(-5000);
    });

    proc.on('error', (err) => {
      cleanup();
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const message = app.isPackaged
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

function buildImageMap(project: ProjectLike): Map<string, string> {
  const map = new Map<string, string>();
  for (const img of project.images) map.set(img.id, img.filePath);
  for (const img of project.article.importedImages) map.set(img.id, img.filePath);
  return map;
}

function computeImageDurations(
  refs: ImageAssetRefLike[],
  totalDurationSec: number
): number[] {
  const n = refs.length;
  if (n === 0) return [];

  const durations: number[] = new Array(n).fill(0);
  let specifiedSum = 0;
  let specifiedCount = 0;

  for (let i = 0; i < n; i++) {
    const d = refs[i].displayDurationSec;
    if (Number.isFinite(d) && (d as number) > 0) {
      durations[i] = d as number;
      specifiedSum += durations[i];
      specifiedCount += 1;
    }
  }

  const remainingCount = n - specifiedCount;
  const targetTotal = Math.max(0.1, totalDurationSec);

  if (specifiedCount === n) {
    if (specifiedSum <= 0) {
      const each = targetTotal / n;
      for (let i = 0; i < n; i++) durations[i] = each;
    } else if (Math.abs(specifiedSum - targetTotal) / targetTotal > 0.05) {
      // 5%以上ズレている場合は全体をスケール
      const scale = targetTotal / specifiedSum;
      for (let i = 0; i < n; i++) durations[i] *= scale;
    }
  } else {
    const remainingTotal = Math.max(0, targetTotal - specifiedSum);
    const each = remainingCount > 0 ? remainingTotal / remainingCount : 0;
    for (let i = 0; i < n; i++) {
      if (durations[i] === 0) durations[i] = each;
    }
  }

  // 最小表示時間と合計合わせ（最後で微調整）
  const minSec = 0.5;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    durations[i] = Math.max(minSec, durations[i]);
    sum += durations[i];
  }
  const diff = targetTotal - sum;
  durations[n - 1] = Math.max(minSec, durations[n - 1] + diff);

  return durations;
}

async function writeImageConcatList(
  entries: Array<{ filePath: string; durationSec: number }>,
  listPath: string
): Promise<void> {
  if (entries.length === 0) throw new Error('画像がありません');

  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`file '${e.filePath.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${e.durationSec.toFixed(3)}`);
  }
  // concat demuxerは最後の file を duration無しで置く必要がある
  const last = entries[entries.length - 1];
  lines.push(`file '${last.filePath.replace(/'/g, "'\\''")}'`);

  await fs.writeFile(listPath, lines.join('\n'), 'utf-8');
}

async function normalizeVideoToSpec(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  options: RenderOptions,
  job: VideoJob
): Promise<void> {
  const { width, height } = parseResolution(options.resolution);
  const vf = buildScalePadFilter(width, height);
  const hasAudio = await probeHasAudio(ffmpegPath, inputPath);

  const args: string[] = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
  ];

  if (!hasAudio) {
    // 音声トラックが無い動画は無音を追加して規格統一
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }

  // 出力マッピング（最初の映像 + あるなら音声）
  args.push('-map', '0:v:0');
  if (hasAudio) {
    args.push('-map', '0:a:0');
  } else {
    args.push('-map', '1:a:0', '-shortest');
  }

  // 出力オプション（必ず全入力の後に置く）
  args.push(
    '-vf',
    vf,
    '-r',
    String(options.fps),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-b:v',
    options.videoBitrate,
    '-c:a',
    'aac',
    '-b:a',
    options.audioBitrate,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    outputPath
  );

  await runFfmpeg(ffmpegPath, args, job);
}

async function renderPartVideo(
  ffmpegPath: string,
  project: ProjectLike,
  part: PartLike,
  options: RenderOptions,
  outputPath: string,
  job: VideoJob,
  onPercent?: (withinPart: number) => void
): Promise<{ durationSec: number }> {
  if (!part.audio?.filePath) {
    throw new Error(`音声未生成のパートがあります: ${part.index + 1} ${part.title}`);
  }
  if (!Array.isArray(part.panelImages) || part.panelImages.length === 0) {
    throw new Error(`画像未割り当てのパートがあります: ${part.index + 1} ${part.title}`);
  }

  const audioPath = part.audio.filePath;
  if (!(await fileExists(audioPath))) {
    throw new Error(`音声ファイルが見つかりません: ${audioPath}`);
  }

  const imageMap = buildImageMap(project);
  const imagePaths = part.panelImages.map((ref) => {
    const p = imageMap.get(ref.imageId);
    if (!p) throw new Error(`画像が見つかりません (imageId=${ref.imageId})`);
    return p;
  });

  const totalDurationSec = Math.max(0.1, part.audio.durationSec);
  const durations = computeImageDurations(part.panelImages, totalDurationSec);
  const entries = imagePaths.map((p, i) => ({ filePath: p, durationSec: durations[i] }));

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-'));
  const listPath = path.join(tmpDir, `part-${part.id}.txt`);
  await writeImageConcatList(entries, listPath);

  const { width, height } = parseResolution(options.resolution);
  const vf = buildScalePadFilter(width, height);

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-i',
    audioPath,
    '-vf',
    vf,
    '-r',
    String(options.fps),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-tune',
    'stillimage',
    '-b:v',
    options.videoBitrate,
    '-c:a',
    'aac',
    '-b:a',
    options.audioBitrate,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  let lastOutTimeMs = 0;
  await runFfmpeg(ffmpegPath, args, job, (kv) => {
    const outTimeMs = kv.out_time_ms ? Number(kv.out_time_ms) : null;
    if (outTimeMs && Number.isFinite(outTimeMs)) {
      lastOutTimeMs = outTimeMs;
      const sec = outTimeMs / 1_000_000;
      const p = Math.max(0, Math.min(1, sec / totalDurationSec));
      onPercent?.(p);
    }
  });

  // tmp cleanup (best-effort)
  await fs.rm(tmpDir, { recursive: true, force: true });

  // 最終到達分を返す（out_time_ms が取れないケースもあるので audio.durationSec を返す）
  const durationSec = lastOutTimeMs > 0 ? lastOutTimeMs / 1_000_000 : totalDurationSec;
  return { durationSec };
}

async function concatSegments(
  ffmpegPath: string,
  segmentPaths: string[],
  outputPath: string,
  options: RenderOptions,
  job: VideoJob
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-'));
  const listPath = path.join(tmpDir, 'concat.txt');
  const lines = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`);
  await fs.writeFile(listPath, lines.join('\n'), 'utf-8');

  // まずは高速に stream copy を試す（同一仕様で生成している前提）
  const copyArgs = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outputPath,
  ];
  try {
    await runFfmpeg(ffmpegPath, copyArgs, job);
    await fs.rm(tmpDir, { recursive: true, force: true });
    return;
  } catch {
    // fallback: re-encode
  }

  const { width, height } = parseResolution(options.resolution);
  const vf = buildScalePadFilter(width, height);
  const reencodeArgs = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-vf',
    vf,
    '-r',
    String(options.fps),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-b:v',
    options.videoBitrate,
    '-c:a',
    'aac',
    '-b:a',
    options.audioBitrate,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    outputPath,
  ];
  await runFfmpeg(ffmpegPath, reencodeArgs, job);
  await fs.rm(tmpDir, { recursive: true, force: true });
}

async function findProjectByPartId(partId: string): Promise<{ projectPath: string; project: ProjectLike; part: PartLike }> {
  const projectsDir = path.join(app.getPath('userData'), 'projects');
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('.newsproj')) continue;
    const projectPath = path.join(projectsDir, entry.name);
    try {
      const [meta, article, parts, images, audio] = await Promise.all([
        fs.readFile(path.join(projectPath, 'project.json'), 'utf-8').then(JSON.parse),
        fs.readFile(path.join(projectPath, 'article.json'), 'utf-8').then(JSON.parse),
        fs.readFile(path.join(projectPath, 'parts.json'), 'utf-8').then(JSON.parse),
        fs.readFile(path.join(projectPath, 'images.json'), 'utf-8').then(JSON.parse),
        fs.readFile(path.join(projectPath, 'audio.json'), 'utf-8').then(JSON.parse),
      ]);

      const hit = (parts as PartLike[]).find((p) => p.id === partId);
      if (!hit) continue;

      const project: ProjectLike = {
        id: meta.id,
        name: meta.name,
        path: projectPath,
        parts,
        images,
        audio,
        article,
      };
      return { projectPath, project, part: hit };
    } catch {
      // ignore
    }
  }
  throw new Error(`Part not found: ${partId}`);
}

ipcMain.handle(
  'video:cancelRender',
  async (): Promise<{ success: boolean }> => {
    if (!currentJob) return { success: true };
    currentJob.canceled = true;
    for (const proc of currentJob.processes) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    return { success: true };
  }
);

ipcMain.handle(
  'video:preview',
  async (_, partId: string): Promise<{ previewPath: string }> => {
    if (currentJob) throw new Error('別の動画処理が実行中です');
    const job: VideoJob = { canceled: false, processes: new Set() };
    currentJob = job;
    try {
      sendProgress({ stage: 'preparing', percent: 0, message: 'プレビュー準備中...' });

      const { project, part } = await findProjectByPartId(partId);
      const ffmpegPath = await resolveFfmpegPath();

      const previewDir = path.join(project.path, 'output', 'previews');
      await fs.mkdir(previewDir, { recursive: true });
      const previewPath = path.join(previewDir, `preview-part-${part.index + 1}-${part.id.slice(0, 8)}.mp4`);

      const previewOptions: RenderOptions = {
        resolution: '1280x720',
        fps: 30,
        videoBitrate: '2M',
        audioBitrate: '128k',
        includeOpening: false,
        includeEnding: false,
      };

      sendProgress({
        stage: 'rendering_parts',
        percent: 10,
        current: 1,
        total: 1,
        message: `プレビュー生成中: ${part.index + 1}/${project.parts.length}`,
      });

      await renderPartVideo(
        ffmpegPath,
        project,
        part,
        previewOptions,
        previewPath,
        job,
        (within) => {
          sendProgress({
            stage: 'rendering_parts',
            percent: Math.round(10 + within * 80),
            current: 1,
            total: 1,
            message: `プレビュー生成中...`,
          });
        }
      );

      sendProgress({ stage: 'finalizing', percent: 100, message: '完了' });
      return { previewPath };
    } finally {
      currentJob = null;
    }
  }
);

ipcMain.handle(
  'video:render',
  async (_, project: ProjectLike, options: RenderOptions, outputPath: string): Promise<{ outputPath: string }> => {
    if (currentJob) throw new Error('別の動画処理が実行中です');
    const job: VideoJob = { canceled: false, processes: new Set() };
    currentJob = job;

    try {
      if (!outputPath) throw new Error('出力先が未指定です');

      sendProgress({ stage: 'preparing', percent: 0, message: 'レンダリング準備中...' });

      const ffmpegPath = await resolveFfmpegPath();
      const { width, height } = parseResolution(options.resolution);
      if (!Number.isFinite(options.fps) || options.fps <= 0) throw new Error('fps が不正です');

      // 出力先ディレクトリ
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // パート動画を生成
      const partsDir = path.join(project.path, 'output', 'parts');
      await fs.mkdir(partsDir, { recursive: true });

      const parts = project.parts.slice().sort((a, b) => a.index - b.index);
      const totalParts = parts.length;
      if (totalParts === 0) throw new Error('パートがありません');

      const generatedPartPaths: string[] = [];
      const partDurations: number[] = [];

      for (let i = 0; i < totalParts; i++) {
        assertNotCanceled(job);

        const part = parts[i];
        const partOut = path.join(partsDir, `part-${String(part.index + 1).padStart(2, '0')}-${part.id.slice(0, 8)}.mp4`);

        sendProgress({
          stage: 'rendering_parts',
          percent: Math.round((i / totalParts) * 80),
          current: i + 1,
          total: totalParts,
          message: `パート動画生成: ${i + 1}/${totalParts} (${part.title})`,
          meta: { width, height },
        });

        const { durationSec } = await renderPartVideo(
          ffmpegPath,
          project,
          part,
          options,
          partOut,
          job,
          (within) => {
            const overall = (i + within) / totalParts;
            sendProgress({
              stage: 'rendering_parts',
              percent: Math.round(overall * 80),
              current: i + 1,
              total: totalParts,
              message: `パート動画生成: ${i + 1}/${totalParts} (${part.title})`,
            });
          }
        );

        generatedPartPaths.push(partOut);
        partDurations.push(durationSec);
      }

      // opening/ending を含める場合は spec に正規化してから concat
      const settings = await readSettings();
      const segments: string[] = [];

      if (options.includeOpening) {
        const opening = settings.openingVideoPath;
        if (!opening) throw new Error('オープニング動画が未設定です（設定画面で指定してください）');
        if (!(await fileExists(opening))) throw new Error(`オープニング動画が見つかりません: ${opening}`);
        const normalized = path.join(project.path, 'output', 'opening.normalized.mp4');
        sendProgress({ stage: 'preparing', percent: 82, message: 'オープニング動画を調整中...' });
        await normalizeVideoToSpec(ffmpegPath, opening, normalized, options, job);
        segments.push(normalized);
      }

      segments.push(...generatedPartPaths);

      if (options.includeEnding) {
        const ending = settings.endingVideoPath;
        if (!ending) throw new Error('エンディング動画が未設定です（設定画面で指定してください）');
        if (!(await fileExists(ending))) throw new Error(`エンディング動画が見つかりません: ${ending}`);
        const normalized = path.join(project.path, 'output', 'ending.normalized.mp4');
        sendProgress({ stage: 'preparing', percent: 86, message: 'エンディング動画を調整中...' });
        await normalizeVideoToSpec(ffmpegPath, ending, normalized, options, job);
        segments.push(normalized);
      }

      // concat
      sendProgress({ stage: 'concatenating', percent: 90, message: '全体動画を連結中...' });
      await concatSegments(ffmpegPath, segments, outputPath, options, job);

      sendProgress({ stage: 'finalizing', percent: 100, message: 'レンダリング完了' });
      return { outputPath };
    } finally {
      currentJob = null;
    }
  }
);
