import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  normalizePresentationProfile,
  resolvePresentationSourceLine,
} from '../../shared/project/presentationProfile';
import {
  resolveVideoBackend,
  type ResolvedVideoBackend,
} from '../video/backend';
import { probeHasAudio, runFfmpeg, type VideoJob } from '../video/ffmpeg';
import {
  concatSegmentsNative,
  normalizeVideoClipNative,
  renderClosingCardVideoNative,
  renderPartVideoNative,
} from '../video/native';

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
  videoPartLeadInSec?: number;
};

type ImageAssetLike = { id: string; filePath: string };
type AudioAssetLike = { id: string; filePath: string; durationSec: number };
type ImageAssetRefLike = { imageId: string; displayDurationSec?: number };
type PresentationProfileLike = {
  closingCardEnabled?: boolean;
  closingCardHeadline?: string;
  closingCardCtaText?: string;
  sourceDisplayMode?: 'auto' | 'hidden' | 'custom';
  sourceDisplayText?: string;
};
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
  article: { title?: string; source?: string; importedImages: ImageAssetLike[] };
  presentationProfile?: PresentationProfileLike;
};

let currentJob: VideoJob | null = null;

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

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateForClosingCard(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function escapeDrawtextValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,');
}

async function resolveDrawtextFontFile(): Promise<string | null> {
  const candidates = [
    '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
    '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return null;
}

function buildDrawtextFilter(options: {
  textFilePath: string;
  x: string;
  y: string;
  fontSize: number;
  fontColor?: string;
  boxColor?: string;
  boxBorderW?: number;
  lineSpacing?: number;
  fontFile?: string | null;
}): string {
  const {
    textFilePath,
    x,
    y,
    fontSize,
    fontColor = 'white',
    boxColor = 'black@0.35',
    boxBorderW = 20,
    lineSpacing = 6,
    fontFile = null,
  } = options;

  const segments: string[] = [];
  if (fontFile) segments.push(`fontfile='${escapeDrawtextValue(fontFile)}'`);
  segments.push(`textfile='${escapeDrawtextValue(textFilePath)}'`);
  segments.push(`fontcolor=${fontColor}`);
  segments.push(`fontsize=${fontSize}`);
  segments.push(`line_spacing=${lineSpacing}`);
  segments.push(`x=${x}`);
  segments.push(`y=${y}`);
  segments.push('box=1');
  segments.push(`boxcolor=${boxColor}`);
  segments.push(`boxborderw=${boxBorderW}`);
  return `drawtext=${segments.join(':')}`;
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
      videoPartLeadInSec:
        typeof parsed.videoPartLeadInSec === 'number' && Number.isFinite(parsed.videoPartLeadInSec)
          ? parsed.videoPartLeadInSec
          : undefined,
    };
  } catch {
    return {};
  }
}

async function resolveVideoExecutionBackend(): Promise<ResolvedVideoBackend> {
  return resolveVideoBackend({
    envValue: process.env.NEWSVIDEO_VIDEO_BACKEND,
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
}

function runVideoFfmpeg(
  ffmpegPath: string,
  args: string[],
  job: VideoJob,
  onProgress?: (progress: Record<string, string>) => void
): Promise<void> {
  return runFfmpeg(ffmpegPath, args, job, onProgress, { isPackaged: app.isPackaged });
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
  backend: ResolvedVideoBackend,
  inputPath: string,
  outputPath: string,
  options: RenderOptions,
  job: VideoJob
): Promise<void> {
  const { width, height } = parseResolution(options.resolution);

  if (backend.id === 'native') {
    await normalizeVideoClipNative(
      backend.rendererPath,
      {
        inputPath,
        outputPath,
        width,
        height,
        fps: options.fps,
        videoBitrate: options.videoBitrate,
        audioBitrate: options.audioBitrate,
      },
      job
    );
    return;
  }

  const ffmpegPath = backend.ffmpegPath;
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

  await runVideoFfmpeg(ffmpegPath, args, job);
}

async function renderPartVideo(
  backend: ResolvedVideoBackend,
  project: ProjectLike,
  part: PartLike,
  options: RenderOptions,
  outputPath: string,
  job: VideoJob,
  leadInSec: number,
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

  const clampedLeadInSec =
    Number.isFinite(leadInSec) && leadInSec > 0 ? Math.min(2, Math.max(0, leadInSec)) : 0;
  const leadInMs = Math.round(clampedLeadInSec * 1000);

  const audioDurationSec = Math.max(0.1, part.audio.durationSec);
  const totalDurationSec = audioDurationSec + clampedLeadInSec;
  const durations = computeImageDurations(part.panelImages, audioDurationSec);
  if (durations.length > 0 && clampedLeadInSec > 0) {
    durations[0] += clampedLeadInSec;
  }
  const entries = imagePaths.map((p, i) => ({ filePath: p, durationSec: durations[i] }));
  const { width, height } = parseResolution(options.resolution);

  if (backend.id === 'native') {
    let lastOutTimeMs = 0;
    await renderPartVideoNative(
      backend.rendererPath,
      {
        outputPath,
        width,
        height,
        fps: options.fps,
        videoBitrate: options.videoBitrate,
        audioBitrate: options.audioBitrate,
        audioPath,
        audioDelayMs: leadInMs,
        imageEntries: entries,
      },
      job,
      (kv) => {
        const outTimeMs = kv.out_time_ms ? Number(kv.out_time_ms) : null;
        if (outTimeMs && Number.isFinite(outTimeMs)) {
          lastOutTimeMs = outTimeMs;
          const sec = outTimeMs / 1_000_000;
          const p = Math.max(0, Math.min(1, sec / totalDurationSec));
          onPercent?.(p);
        }
      }
    );

    const durationSec = lastOutTimeMs > 0 ? lastOutTimeMs / 1_000_000 : totalDurationSec;
    return { durationSec };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-'));
  const listPath = path.join(tmpDir, `part-${part.id}.txt`);
  await writeImageConcatList(entries, listPath);

  const vf = buildScalePadFilter(width, height);
  const ffmpegPath = backend.ffmpegPath;

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
    ...(leadInMs > 0 ? (['-af', `adelay=${leadInMs}|${leadInMs}`] as const) : []),
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  let lastOutTimeMs = 0;
  await runVideoFfmpeg(ffmpegPath, args, job, (kv) => {
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
  backend: ResolvedVideoBackend,
  segmentPaths: string[],
  outputPath: string,
  options: RenderOptions,
  job: VideoJob
): Promise<void> {
  const { width, height } = parseResolution(options.resolution);

  if (backend.id === 'native') {
    await concatSegmentsNative(
      backend.rendererPath,
      {
        outputPath,
        width,
        height,
        fps: options.fps,
        videoBitrate: options.videoBitrate,
        audioBitrate: options.audioBitrate,
        segmentPaths,
      },
      job
    );
    return;
  }

  const ffmpegPath = backend.ffmpegPath;
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
    await runVideoFfmpeg(ffmpegPath, copyArgs, job);
    await fs.rm(tmpDir, { recursive: true, force: true });
    return;
  } catch {
    // fallback: re-encode
  }

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
  await runVideoFfmpeg(ffmpegPath, reencodeArgs, job);
  await fs.rm(tmpDir, { recursive: true, force: true });
}

async function renderClosingCardVideo(
  backend: ResolvedVideoBackend,
  project: ProjectLike,
  options: RenderOptions,
  outputPath: string,
  tempDir: string,
  job: VideoJob
): Promise<string | null> {
  const presentationProfile = normalizePresentationProfile(project.presentationProfile);
  if (!presentationProfile.closingCardEnabled) return null;

  const headline = truncateForClosingCard(
    compactWhitespace(presentationProfile.closingCardHeadline),
    48
  );
  const cta = truncateForClosingCard(
    compactWhitespace(presentationProfile.closingCardCtaText),
    76
  );
  const source = truncateForClosingCard(
    compactWhitespace(resolvePresentationSourceLine(presentationProfile, project.article.source) ?? ''),
    88
  );
  const lines = [headline || '', cta || '', source || ''].filter(Boolean);
  if (lines.length === 0) return null;

  if (backend.id === 'native') {
    const { width, height } = parseResolution(options.resolution);
    await renderClosingCardVideoNative(
      backend.rendererPath,
      {
        outputPath,
        width,
        height,
        fps: options.fps,
        videoBitrate: options.videoBitrate,
        durationSec: 3.6,
        headline: headline || undefined,
        cta: cta || undefined,
        source: source || undefined,
      },
      job
    );
    return outputPath;
  }

  const ffmpegPath = backend.ffmpegPath;
  const fontFile = await resolveDrawtextFontFile();
  const textDir = await fs.mkdtemp(path.join(tempDir, 'closing-card-'));
  const filters: string[] = [];
  const lineDefinitions = [
    {
      text: headline,
      y: 'h*0.30-text_h/2',
      fontSize: 68,
      fontColor: 'white',
      boxColor: 'black@0.4',
      boxBorderW: 24,
    },
    {
      text: cta,
      y: 'h*0.56-text_h/2',
      fontSize: 38,
      fontColor: '0xdbeafe',
      boxColor: 'black@0.3',
      boxBorderW: 18,
    },
    {
      text: source,
      y: 'h*0.74-text_h/2',
      fontSize: 28,
      fontColor: '0xcbd5e1',
      boxColor: 'black@0.22',
      boxBorderW: 14,
    },
  ] as const;

  for (let index = 0; index < lineDefinitions.length; index += 1) {
    const definition = lineDefinitions[index];
    if (!definition.text) continue;
    const textFilePath = path.join(textDir, `line-${index + 1}.txt`);
    await fs.writeFile(textFilePath, `${definition.text}\n`, 'utf-8');
    filters.push(
      buildDrawtextFilter({
        textFilePath,
        x: '(w-text_w)/2',
        y: definition.y,
        fontSize: definition.fontSize,
        fontColor: definition.fontColor,
        boxColor: definition.boxColor,
        boxBorderW: definition.boxBorderW,
        fontFile,
      })
    );
  }

  if (filters.length === 0) {
    await fs.rm(textDir, { recursive: true, force: true });
    return null;
  }

  const { width, height } = parseResolution(options.resolution);
  const durationSec = 3.6;
  const background = 'color=c=0x0f172a:s=' + `${width}x${height}:d=${durationSec}:r=${options.fps}`;
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    background,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter:v',
    filters.join(','),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-shortest',
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

  try {
    await runVideoFfmpeg(ffmpegPath, args, job);
  } finally {
    await fs.rm(textDir, { recursive: true, force: true });
  }

  return outputPath;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function requestVideoPathReauthorization(
  sourcePath: string,
  baseName: 'opening' | 'ending'
): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const displayName = baseName === 'opening' ? 'オープニング' : 'エンディング';
  const result = await dialog.showOpenDialog(owner, {
    title: `${displayName}動画を再選択`,
    message: `${displayName}動画へのアクセス権限が必要です。同じファイルを再選択してください。`,
    defaultPath: sourcePath,
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm'] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}

async function stageVideoInputForFfmpeg(
  sourcePath: string,
  tempDir: string,
  baseName: 'opening' | 'ending'
): Promise<string> {
  const ext = path.extname(sourcePath) || '.mp4';
  const stagedPath = path.join(tempDir, `${baseName}.source${ext}`);
  try {
    await fs.copyFile(sourcePath, stagedPath);
    return stagedPath;
  } catch (error) {
    const detail = formatUnknownError(error);
    const nodeError = error as NodeJS.ErrnoException;
    const permissionError =
      nodeError?.code === 'EPERM' ||
      nodeError?.code === 'EACCES' ||
      /operation not permitted/i.test(detail) ||
      /permission denied/i.test(detail);

    if (permissionError) {
      const reselected = await requestVideoPathReauthorization(sourcePath, baseName);
      if (reselected) {
        try {
          await fs.copyFile(reselected, stagedPath);
          return stagedPath;
        } catch (retryError) {
          const retryDetail = formatUnknownError(retryError);
          throw new Error(
            `${baseName === 'opening' ? 'オープニング' : 'エンディング'}動画にアクセスできません: ${reselected}\n` +
              `アクセス可能な場所へ移動して再指定してください。 (${retryDetail})`
          );
        }
      }
    }

    throw new Error(
      `${baseName === 'opening' ? 'オープニング' : 'エンディング'}動画にアクセスできません: ${sourcePath}\n` +
        `ファイル権限を確認するか、アクセス可能な場所へ移動して再指定してください。 (${detail})`
    );
  }
}

async function copyRenderedOutput(stagedOutputPath: string, outputPath: string): Promise<void> {
  try {
    await fs.copyFile(stagedOutputPath, outputPath);
  } catch (error) {
    const detail = formatUnknownError(error);
    throw new Error(
      `出力先に動画を書き込めません: ${outputPath}\n` +
        `出力先フォルダの権限を確認してください。 (${detail})`
    );
  }
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
      const backend = await resolveVideoExecutionBackend();

      const settings = await readSettings();
      const leadInSec = settings.videoPartLeadInSec ?? 0.3;

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
        backend,
        project,
        part,
        previewOptions,
        previewPath,
        job,
        leadInSec,
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

    let renderTmpDir: string | null = null;
    try {
      if (!outputPath) throw new Error('出力先が未指定です');

      sendProgress({ stage: 'preparing', percent: 0, message: 'レンダリング準備中...' });

      const backend = await resolveVideoExecutionBackend();
      const { width, height } = parseResolution(options.resolution);
      if (!Number.isFinite(options.fps) || options.fps <= 0) throw new Error('fps が不正です');

      // 出力先ディレクトリ
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      renderTmpDir = await fs.mkdtemp(path.join(project.path, 'output', 'render-tmp-'));

      const settings = await readSettings();
      const leadInSec = settings.videoPartLeadInSec ?? 0.3;
      const presentationProfile = normalizePresentationProfile(project.presentationProfile);

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
          backend,
          project,
          part,
          options,
          partOut,
          job,
          leadInSec,
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
      const segments: string[] = [];

      if (options.includeOpening) {
        const opening = settings.openingVideoPath;
        if (!opening) throw new Error('オープニング動画が未設定です（設定画面で指定してください）');
        if (!(await fileExists(opening))) throw new Error(`オープニング動画が見つかりません: ${opening}`);
        const openingInputForFfmpeg = await stageVideoInputForFfmpeg(opening, renderTmpDir, 'opening');
        const normalized = path.join(renderTmpDir, 'opening.normalized.mp4');
        sendProgress({ stage: 'preparing', percent: 82, message: 'オープニング動画を調整中...' });
        await normalizeVideoToSpec(backend, openingInputForFfmpeg, normalized, options, job);
        segments.push(normalized);
      }

      segments.push(...generatedPartPaths);

      if (presentationProfile.closingCardEnabled) {
        const closingCardPath = path.join(renderTmpDir, 'closing-card.mp4');
        sendProgress({ stage: 'preparing', percent: 84, message: '締めカードを生成中...' });
        const renderedClosingCard = await renderClosingCardVideo(
          backend,
          {
            ...project,
            presentationProfile,
          },
          options,
          closingCardPath,
          renderTmpDir,
          job
        );
        if (renderedClosingCard) {
          segments.push(renderedClosingCard);
        }
      }

      if (options.includeEnding) {
        const ending = settings.endingVideoPath;
        if (!ending) throw new Error('エンディング動画が未設定です（設定画面で指定してください）');
        if (!(await fileExists(ending))) throw new Error(`エンディング動画が見つかりません: ${ending}`);
        const endingInputForFfmpeg = await stageVideoInputForFfmpeg(ending, renderTmpDir, 'ending');
        const normalized = path.join(renderTmpDir, 'ending.normalized.mp4');
        sendProgress({ stage: 'preparing', percent: 86, message: 'エンディング動画を調整中...' });
        await normalizeVideoToSpec(backend, endingInputForFfmpeg, normalized, options, job);
        segments.push(normalized);
      }

      // concat
      sendProgress({ stage: 'concatenating', percent: 90, message: '全体動画を連結中...' });
      const stagedOutputPath = path.join(renderTmpDir, 'final.rendered.mp4');
      await concatSegments(backend, segments, stagedOutputPath, options, job);
      assertNotCanceled(job);

      sendProgress({ stage: 'finalizing', percent: 97, message: '出力ファイルを書き込み中...' });
      await copyRenderedOutput(stagedOutputPath, outputPath);

      sendProgress({ stage: 'finalizing', percent: 100, message: 'レンダリング完了' });
      return { outputPath };
    } finally {
      if (renderTmpDir) {
        try {
          await fs.rm(renderTmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
      currentJob = null;
    }
  }
);
