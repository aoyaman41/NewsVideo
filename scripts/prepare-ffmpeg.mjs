import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const require = createRequire(import.meta.url);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isDarwin() {
  return process.platform === 'darwin';
}

async function main() {
  if (!isDarwin()) {
    console.log('[prepare-ffmpeg] skip (not macOS)');
    return;
  }

  const projectRoot = process.cwd();
  const outDir = path.join(projectRoot, 'resources', 'ffmpeg');
  await fs.mkdir(outDir, { recursive: true });

  let ffmpegStaticPath;
  let ffprobeStaticPath;

  try {
    ffmpegStaticPath = require('ffmpeg-static');
  } catch {
    throw new Error(
      'ffmpeg-static が見つかりません。`npm i -D ffmpeg-static ffprobe-static` を実行してください。'
    );
  }

  try {
    const ffprobe = require('ffprobe-static');
    ffprobeStaticPath = ffprobe?.path;
  } catch {
    throw new Error(
      'ffprobe-static が見つかりません。`npm i -D ffmpeg-static ffprobe-static` を実行してください。'
    );
  }

  if (!ffmpegStaticPath || typeof ffmpegStaticPath !== 'string') {
    throw new Error('ffmpeg-static のパス解決に失敗しました');
  }
  if (!ffprobeStaticPath || typeof ffprobeStaticPath !== 'string') {
    throw new Error('ffprobe-static のパス解決に失敗しました');
  }

  if (!(await fileExists(ffmpegStaticPath))) {
    throw new Error(`ffmpeg バイナリが見つかりません: ${ffmpegStaticPath}`);
  }
  if (!(await fileExists(ffprobeStaticPath))) {
    throw new Error(`ffprobe バイナリが見つかりません: ${ffprobeStaticPath}`);
  }

  const ffmpegOut = path.join(outDir, 'ffmpeg');
  const ffprobeOut = path.join(outDir, 'ffprobe');

  await fs.copyFile(ffmpegStaticPath, ffmpegOut);
  await fs.copyFile(ffprobeStaticPath, ffprobeOut);

  await fs.chmod(ffmpegOut, 0o755);
  await fs.chmod(ffprobeOut, 0o755);

  console.log('[prepare-ffmpeg] done');
  console.log(`- ${ffmpegOut}`);
  console.log(`- ${ffprobeOut}`);
}

main().catch((err) => {
  console.error('[prepare-ffmpeg] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

