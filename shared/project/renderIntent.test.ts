import { describe, expect, it } from 'vitest';
import { createNewPart, createNewProject, type Project } from './schema';
import { classifyGenerationError } from './jobs';
import {
  RENDER_CONFLICT_MARKER,
  isRenderConflictError,
  partRenderFingerprint,
  renderConflictMessage,
  renderContentFingerprint,
  stripRenderConflictMarker,
} from './renderIntent';

function project(): Project {
  const base = createNewProject('Render intent', '/tmp/project');
  const imageId = crypto.randomUUID();
  const parts = [0, 1].map((index) => {
    const part = createNewPart(index, { title: `P${index + 1}`, scriptText: 'Narration' });
    part.panelImages = [{ imageId }];
    part.audio = {
      id: crypto.randomUUID(),
      filePath: `/tmp/project/audio/${index}.wav`,
      durationSec: 3,
      ttsEngine: 'gemini_tts',
      voiceId: 'Charon',
      settings: { speakingRate: 1, pitch: 0, languageCode: 'ja-JP' },
      generatedAt: '2026-09-26T00:00:00.000Z',
    };
    return part;
  });
  return {
    ...base,
    revision: 4,
    parts,
    images: [
      {
        id: imageId,
        filePath: '/tmp/project/images/a.png',
        sourceType: 'generated',
        metadata: {
          width: 1920,
          height: 1080,
          mimeType: 'image/png',
          fileSize: 1,
          createdAt: '2026-09-26T00:00:00.000Z',
          tags: [],
        },
      },
    ],
  };
}

describe('renderContentFingerprint', () => {
  it('ignores saves that do not change the exported video', () => {
    const original = project();
    const touched: Project = {
      ...structuredClone(original),
      revision: 9,
      updatedAt: '2026-09-27T00:00:00.000Z',
      metrics: {
        ...structuredClone(original.metrics),
        firstPreviewAt: '2026-09-27T00:00:00.000Z',
      } as Project['metrics'],
      outputSettings: {
        resolution: '1920x1080',
        fps: 30,
        videoBitrate: '8M',
        audioBitrate: '192k',
        includeOpening: false,
        includeEnding: false,
      },
      autoGenerationStatus: { running: false, lastVideoPath: '/tmp/out.mp4' },
      usage: [],
      generationConfig: { imageModel: 'gemini-3-pro-image' },
    };
    touched.parts[0].title = 'Renamed';
    touched.parts[0].scriptText = 'Edited (freshness is checked separately)';
    expect(renderContentFingerprint(touched)).toBe(renderContentFingerprint(original));
    // パートの並び順(配列の順)ではなく index で比べる
    touched.parts.reverse();
    expect(renderContentFingerprint(touched)).toBe(renderContentFingerprint(original));
  });

  it.each<[string, (project: Project) => void]>([
    ['audio', (p) => (p.parts[1].audio = { ...p.parts[1].audio!, id: crypto.randomUUID() })],
    ['image file', (p) => (p.images[0].filePath = '/tmp/project/images/b.png')],
    ['cut duration', (p) => (p.parts[0].panelImages[0].displayDurationSec = 2)],
    ['part order', (p) => ([p.parts[0].index, p.parts[1].index] = [1, 0])],
    ['removed part', (p) => p.parts.pop()],
    [
      'captions',
      (p) => {
        p.parts[0].captionsEnabled = true;
        p.parts[0].captions = [{ id: 'c', start: 0, end: 1, text: '字幕', timing: 'manual' }];
      },
    ],
    ['closing card', (p) => (p.presentationProfile.closingCardHeadline = 'New headline')],
    ['aspect ratio', (p) => (p.presentationProfile.aspectRatio = '9:16')],
  ])('detects a change of %s', (_label, change) => {
    const original = project();
    const changed = structuredClone(original);
    change(changed);
    expect(renderContentFingerprint(changed)).not.toBe(renderContentFingerprint(original));
  });
});

describe('partRenderFingerprint', () => {
  it('only reacts to the previewed part', () => {
    const original = project();
    const changed = structuredClone(original);
    changed.parts[1].audio = { ...changed.parts[1].audio!, id: crypto.randomUUID() };
    changed.presentationProfile.closingCardHeadline = 'Only in the full export';
    const [first, second] = original.parts.map((part) => part.id);
    expect(partRenderFingerprint(changed, first)).toBe(partRenderFingerprint(original, first));
    expect(partRenderFingerprint(changed, second)).not.toBe(
      partRenderFingerprint(original, second)
    );
    expect(partRenderFingerprint(original, crypto.randomUUID())).toBeNull();
  });

  it('reacts to the saved output settings that the preview uses', () => {
    const original: Project = {
      ...project(),
      outputSettings: {
        resolution: '1280x720',
        fps: 30,
        videoBitrate: '8M',
        audioBitrate: '192k',
        videoPartLeadInSec: 0.3,
        includeOpening: false,
        includeEnding: false,
      },
    };
    const partId = original.parts[0].id;
    const bitrate = structuredClone(original);
    bitrate.outputSettings!.videoBitrate = '2M';
    expect(partRenderFingerprint(bitrate, partId)).toBe(partRenderFingerprint(original, partId));
    for (const change of [
      (p: Project) => (p.outputSettings!.fps = 60),
      (p: Project) => (p.outputSettings!.resolution = '1920x1080'),
      (p: Project) => (p.outputSettings!.videoPartLeadInSec = 1),
    ]) {
      const changed = structuredClone(original);
      change(changed);
      expect(partRenderFingerprint(changed, partId)).not.toBe(
        partRenderFingerprint(original, partId)
      );
      // 書き出しは出力設定を明示的に受け取るので、保存済みの値は比べない
      expect(renderContentFingerprint(changed)).toBe(renderContentFingerprint(original));
    }
  });
});

describe('render conflict errors', () => {
  it('are recognizable through the IPC error wrapper and classified as conflicts', () => {
    const wrapped = new Error(
      `Error invoking remote method 'video:render': Error: ${renderConflictMessage('render')}`
    );
    expect(isRenderConflictError(wrapped)).toBe(true);
    expect(isRenderConflictError(new Error('別の動画処理が実行中です'))).toBe(false);
    expect(classifyGenerationError(new Error(renderConflictMessage('render'))).kind).toBe(
      'conflict'
    );
    expect(stripRenderConflictMarker(renderConflictMessage('preview'))).not.toContain(
      RENDER_CONFLICT_MARKER
    );
    expect(stripRenderConflictMarker('出力先に動画を書き込めません\n権限を確認')).toBe(
      '出力先に動画を書き込めません\n権限を確認'
    );
  });
});
