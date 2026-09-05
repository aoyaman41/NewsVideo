import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { ProjectRepository } from '../project/repository';
import { createNewPart, createNewProject } from '../../shared/project/schema';
import { deriveIntegrity } from '../../shared/project/integrity';
import { resolutionForAspect } from '../../shared/project/videoFormat';
import { invokeOperation } from '../ipc/operations';
import { renderPartVideoNative, resolveNativeVideoRendererBinary } from './native';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { isPackaged: false, getPath: () => state.root },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
}));
const execute = promisify(execFile);
let inspector: string;
let renderer: string;

function png(red: number, green: number, blue: number) {
  const crc = (buffer: Buffer) => {
    let value = 0xffffffff;
    for (const byte of buffer) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++)
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, data: Buffer) => {
    const content = Buffer.concat([Buffer.from(name), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(content));
    return Buffer.concat([length, content, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function wav(duration = 1) {
  const length = Math.round(24000 * duration);
  const buffer = Buffer.alloc(44 + length * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24);
  buffer.writeUInt32LE(48000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++)
    buffer.writeInt16LE(Math.round(Math.sin((i / 24000) * 440 * 2 * Math.PI) * 4000), 44 + i * 2);
  return buffer;
}

describe.skipIf(process.platform !== 'darwin' || process.env.NEWSVIDEO_NATIVE_TEST !== '1')(
  'native export integration',
  () => {
    beforeAll(async () => {
      state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-native-integration-'));
      inspector = path.join(state.root, 'inspect');
      await execute('xcrun', [
        'swiftc',
        '-parse-as-library',
        '-o',
        inspector,
        path.resolve('scripts/InspectVideo.swift'),
        '-framework',
        'AVFoundation',
        '-framework',
        'CoreGraphics',
      ]);
      renderer = await resolveNativeVideoRendererBinary({ isPackaged: false });
      await import('../ipc/video');
    }, 120000);
    afterAll(async () => {
      if (state.root) await fs.rm(state.root, { recursive: true, force: true });
    });

    it.each(['16:9', '9:16', '1:1'] as const)(
      'exports visible multiple scenes, normalized clips and closing card at %s',
      async (ratio) => {
        const repository = new ProjectRepository(path.join(state.root, 'projects'));
        let project = createNewProject(`Native ${ratio}`, '');
        project.article = {
          title: 'Synthetic verification',
          bodyText: 'Red scene followed by blue scene.',
          importedImages: [],
        };
        project.presentationProfile.aspectRatio = ratio;
        project.presentationProfile.closingCardEnabled = true;
        project = await repository.create(project);
        const audioPath = path.join(project.path, 'audio', 'tone.wav');
        await fs.writeFile(audioPath, wav());
        for (let index = 0; index < 2; index++) {
          const imagePath = path.join(project.path, 'images', `${index}.png`);
          await fs.writeFile(imagePath, index === 0 ? png(220, 30, 30) : png(30, 30, 220));
          const imageId = crypto.randomUUID();
          project.images.push({
            id: imageId,
            sourceType: 'imported',
            filePath: imagePath,
            metadata: {
              width: 1,
              height: 1,
              mimeType: 'image/png',
              fileSize: 69,
              createdAt: new Date().toISOString(),
              tags: [],
            },
          });
          const part = createNewPart(index);
          part.scriptText = `Synthetic scene ${index}`;
          part.panelImages = [{ imageId }];
          part.audio = {
            id: crypto.randomUUID(),
            filePath: audioPath,
            durationSec: 1,
            ttsEngine: 'macos_tts',
            voiceId: 'fixture',
            settings: { speakingRate: 1, pitch: 0, languageCode: 'ja-JP' },
            generatedAt: new Date().toISOString(),
          };
          if (index === 0) { part.graphic = { enabled: true, headline: '編集できる見出し', keyNumber: '42%', source: '固定素材で検証', bars: [{ label: '項目', value: 70 }] }; part.captionsEnabled = true; part.captions = [{ id: crypto.randomUUID(), start: 0, end: 1, text: '字幕を表示する検証', timing: 'manual' }]; }
          project.parts.push(part);
        }
        project.integrity = deriveIntegrity(null, project);
        project = await repository.save(project);
        const greenPath = path.join(project.path, 'images', 'green.png');
        await fs.writeFile(greenPath, png(30, 220, 30));
        const clip = path.join(project.path, 'output', 'clip.mp4');
        await renderPartVideoNative(
          renderer,
          {
            outputPath: clip,
            width: 320,
            height: 240,
            fps: 12,
            videoBitrate: '1M',
            audioBitrate: '128k',
            audioPath,
            audioDelayMs: 0,
            imageEntries: [{ filePath: greenPath, durationSec: 1 }],
          },
          { canceled: false, processes: new Set() }
        );
        await fs.writeFile(
          path.join(state.root, 'settings.json'),
          JSON.stringify({ openingVideoPath: clip, endingVideoPath: clip, videoPartLeadInSec: 0 })
        );
        const resolution = resolutionForAspect('1280x720', ratio);
        const outputPath = path.join(project.path, 'output', 'final.mp4');
        await invokeOperation(
          'video:render',
          project,
          {
            resolution,
            fps: 12,
            videoBitrate: '2M',
            audioBitrate: '128k',
            includeOpening: true,
            includeEnding: true,
          },
          outputPath
        );
        const { stdout } = await execute(inspector, [
          outputPath,
          '0.4',
          '1.4',
          '2.4',
          '4.0',
          '7.0',
        ]);
        const result = JSON.parse(stdout);
        const [width, height] = resolution.split('x').map(Number);
        expect(result).toMatchObject({ videoTracks: 1, audioTracks: 1, width, height });
        expect(result.duration).toBeCloseTo(7.6, 0);
        expect(result.samples[1].brightTop).toBeGreaterThan(100);
        expect(result.samples[1].brightBottom).toBeGreaterThan(100);
        const colors = result.samples.map((sample: { rgb: number[] }) => sample.rgb);
        expect(colors[0][1]).toBeGreaterThan(colors[0][0] * 3);
        expect(colors[1][0]).toBeGreaterThan(colors[1][2] * 3);
        expect(colors[2][2]).toBeGreaterThan(colors[2][0] * 3);
        expect(Math.abs(colors[1][0] - 220)).toBeLessThan(20);
        expect(Math.abs(colors[2][2] - 220)).toBeLessThan(20);
        expect(colors[3].reduce((sum: number, value: number) => sum + value, 0)).toBeGreaterThan(
          20
        );
        expect(colors[4][1]).toBeGreaterThan(colors[4][0] * 3);
        const preview = await invokeOperation<{ previewPath: string }>(
          'video:preview',
          project.parts[0].id
        );
        const inspectedPreview = JSON.parse(
          (await execute(inspector, [preview.previewPath, '0.4'])).stdout
        );
        expect(inspectedPreview).toMatchObject({ videoTracks: 1, audioTracks: 1, width, height });
      },
      180000
    );

    it('resolves the native helper from a bundled module when cwd is outside the repository', async () => {
      const { build } = await import('esbuild');
      const bundled = path.resolve('dist-electron/native-resolution-check.mjs');
      try {
        await build({
          entryPoints: ['electron/video/native.ts'],
          bundle: true,
          platform: 'node',
          format: 'esm',
          outfile: bundled,
        });
        const { stdout } = await execute(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import { resolveNativeVideoRendererBinary } from ${JSON.stringify(pathToFileURL(bundled).href)}; console.log(await resolveNativeVideoRendererBinary({ isPackaged: false }));`,
          ],
          { cwd: state.root }
        );
        expect(stdout.trim()).toBe(renderer);
      } finally {
        await fs.rm(bundled, { force: true });
      }
    }, 30000);
  }
);
