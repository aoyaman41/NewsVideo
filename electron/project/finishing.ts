import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { app, BrowserWindow } from 'electron';
import { registerOperation, invokeOperation } from '../ipc/operations';
import { fileAccess } from '../utils/fileAccess';
import { getProjectRepository } from '../ipc/project';
import {
  serializeCaptions,
  estimateCaptions,
  captionProblems,
} from '../../shared/project/captions';
import { measurePcmWav } from '../../shared/project/audioQuality';
import type { AudioAsset } from '../../shared/project/schema';
import { normalizeSettings } from '../../shared/settings/appSettings';
import { resolveNativeVideoRendererBinary, probeDurationNative } from '../video/native';
const execute = promisify(execFile);

export async function pcmData(file: string, directory: string) {
  const raw = path.join(directory, `${crypto.randomUUID()}.pcm`);
  await execute('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@24000', '-c', '1', file, raw]);
  try {
    const bytes = await fs.readFile(raw);
    measurePcmWav(bytes);
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      const size = bytes.readUInt32LE(offset + 4);
      if (bytes.toString('ascii', offset, offset + 4) === 'data')
        return bytes.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    throw new Error('音声データがありません。');
  } finally {
    await fs.rm(raw, { force: true });
  }
}
export function wavData(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
registerOperation('project:captions', async (_, request: unknown) => {
  const input = z.object({ id: z.string().uuid(), format: z.enum(['srt', 'vtt']) }).parse(request);
  const project = await getProjectRepository().load(input.id);
  const settings = normalizeSettings(await invokeOperation('settings:get'));
  let offset = 0;
  if (project.outputSettings?.includeOpening) {
    const opening = await fileAccess().media(
      project.outputSettings?.openingVideoPath ?? settings.openingVideoPath
    );
    const binary = await resolveNativeVideoRendererBinary({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    });
    offset = await probeDurationNative(binary, opening);
  }
  const captions = [];
  for (const part of project.parts) {
    const cues = part.captions ?? estimateCaptions(part);
    const errors = captionProblems(cues, part.audio?.durationSec ?? part.durationEstimateSec);
    if (errors.some((error) => !error.includes('目安'))) throw new Error(errors.join('\n'));
    const lead = project.outputSettings?.videoPartLeadInSec ?? settings.videoPartLeadInSec ?? 0.3;
    captions.push(
      ...cues.map((cue) => ({
        ...cue,
        start: cue.start + offset + lead,
        end: cue.end + offset + lead,
      }))
    );
    offset += (part.audio?.durationSec ?? part.durationEstimateSec) + lead;
  }
  const file = path.join(project.path, 'output', `captions.${input.format}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, serializeCaptions(captions, input.format));
  return file;
});
registerOperation('tts:replaceSegment', async (_, request: unknown) => {
  const input = z
    .object({
      projectId: z.string().uuid(),
      partId: z.string().uuid(),
      start: z.number().nonnegative(),
      end: z.number().positive(),
      text: z.string().trim().min(1).max(2000),
    })
    .parse(request);
  const repo = getProjectRepository();
  const project = await repo.load(input.projectId);
  const part = project.parts.find((item) => item.id === input.partId);
  if (!part?.audio || input.end <= input.start || input.end > part.audio.durationSec)
    throw new Error('置換する音声区間を確認してください。');
  await fileAccess().media(part.audio.filePath);
  const settings = normalizeSettings(await invokeOperation('settings:get'));
  const generated = await invokeOperation<{
    audio: AudioAsset;
    usage: Record<string, unknown> | null;
  }>(
    'tts:generate',
    input.text,
    {
      ttsEngine: part.audio.ttsEngine,
      ttsModel: settings.ttsModel,
      voiceName: part.audio.voiceId,
      languageCode: part.audio.settings.languageCode,
      speakingRate: part.audio.settings.speakingRate,
      pitch: part.audio.settings.pitch,
      audioEncoding: 'LINEAR16',
    },
    project.id
  );
  // Preserve the paid result before transforming or applying it.
  await repo.update(project.id, (data) => {
    data.audio.push(generated.audio);
    if (generated.usage)
      data.usage.push({
        id: crypto.randomUUID(),
        provider: 'gemini',
        category: 'tts',
        model: settings.ttsModel,
        operation: 'tts_replace_segment',
        inputTokens: Number(generated.usage.inputTokens) || undefined,
        outputTokens: Number(generated.usage.outputTokens) || undefined,
        createdAt: new Date().toISOString(),
      });
  });
  const [original, replacement] = await Promise.all([
    pcmData(part.audio.filePath, project.path),
    pcmData(generated.audio.filePath, project.path),
  ]);
  const pcm = Buffer.concat([
    original.subarray(0, Math.round(input.start * 24000) * 2),
    replacement,
    original.subarray(Math.round(input.end * 24000) * 2),
  ]);
  const filePath = path.join(project.path, 'audio', `${crypto.randomUUID()}.wav`);
  await fs.writeFile(filePath, wavData(pcm));
  let conflict = false;
  const saved = await repo.update(project.id, (data) => {
    const current = data.parts.find((item) => item.id === part.id);
    const audio = {
      ...generated.audio,
      id: crypto.randomUUID(),
      filePath,
      durationSec: pcm.length / 48000,
      segments: undefined,
      timepoints: undefined,
    };
    data.audio.push(audio);
    if (
      !current ||
      current.audio?.id !== part.audio!.id ||
      current.scriptText !== part.scriptText
    ) {
      conflict = true;
      return;
    }
    current.audio = audio;
    const delta = replacement.length / 48000 - (input.end - input.start);
    const cues = part.captions ?? estimateCaptions(part);
    current.captions = [
      ...cues.filter((cue) => cue.end <= input.start),
      {
        id: crypto.randomUUID(),
        start: input.start,
        end: input.start + replacement.length / 48000,
        text: input.text,
        timing: 'manual' as const,
      },
      ...cues
        .filter((cue) => cue.start >= input.end)
        .map((cue) => ({
          ...cue,
          start: cue.start + delta,
          end: cue.end + delta,
          timing: 'manual' as const,
        })),
    ];
    const replacedText = cues
      .filter((cue) => cue.start < input.end && cue.end > input.start)
      .map((cue) => cue.text)
      .join('');
    if (replacedText && (current.narrationText || current.scriptText).includes(replacedText))
      current.narrationText = (current.narrationText || current.scriptText).replace(
        replacedText,
        input.text
      );
  });
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('project:changed', { id: saved.id, revision: saved.revision });
  if (conflict) throw new Error('編集中に音声が変わりました。生成結果は素材として保全しました。');
  return saved;
});
registerOperation('tts:insertPause', async (_, request: unknown) => {
  const input = z
    .object({
      projectId: z.string().uuid(),
      partId: z.string().uuid(),
      at: z.number().nonnegative(),
      seconds: z.number().min(0.1).max(5),
    })
    .parse(request);
  const repo = getProjectRepository();
  const project = await repo.load(input.projectId);
  const part = project.parts.find((item) => item.id === input.partId);
  if (!part?.audio || input.at > part.audio.durationSec)
    throw new Error('音声内の位置を指定してください。');
  const bytes = await pcmData(await fileAccess().media(part.audio.filePath), project.path);
  const split = Math.round(input.at * 24000) * 2;
  const result = Buffer.concat([
    bytes.subarray(0, split),
    Buffer.alloc(Math.round(input.seconds * 24000) * 2),
    bytes.subarray(split),
  ]);
  const filePath = path.join(project.path, 'audio', `${crypto.randomUUID()}.wav`);
  await fs.writeFile(filePath, wavData(result));
  const saved = await repo.update(project.id, (data) => {
    const current = data.parts.find((item) => item.id === part.id);
    if (!current || current.audio?.id !== part.audio!.id)
      throw new Error('音声が変更されました。現在の素材からやり直してください。');
    current.audio = {
      ...part.audio!,
      id: crypto.randomUUID(),
      filePath,
      durationSec: result.length / 48000,
      timepoints: undefined,
    };
    data.audio.push(current.audio);
    current.captions = (current.captions ?? estimateCaptions(part)).map((cue) => ({
      ...cue,
      start: cue.start >= input.at ? cue.start + input.seconds : cue.start,
      end: cue.end > input.at ? cue.end + input.seconds : cue.end,
      timing: 'manual' as const,
    }));
  });
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('project:changed', { id: saved.id, revision: saved.revision });
  return saved;
});
