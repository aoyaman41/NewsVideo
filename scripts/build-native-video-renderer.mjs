import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, 'native', 'video-renderer', 'NativeVideoRenderer.swift');
const outDir = path.join(projectRoot, 'resources', 'native-video-renderer');
const outPath = path.join(outDir, 'native-video-renderer');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'null'}`));
      }
    });
  });
}

async function main() {
  if (process.platform !== 'darwin') {
    console.log('[build-native-video-renderer] skip (not macOS)');
    return;
  }

  await fs.mkdir(outDir, { recursive: true });

  await run('xcrun', [
    'swiftc',
    '-parse-as-library',
    '-O',
    '-o',
    outPath,
    sourcePath,
    '-framework',
    'AVFoundation',
    '-framework',
    'AppKit',
    '-framework',
    'CoreGraphics',
  ]);

  await fs.chmod(outPath, 0o755);
  console.log(`[build-native-video-renderer] built ${outPath}`);
}

main().catch((error) => {
  console.error(
    '[build-native-video-renderer] failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
