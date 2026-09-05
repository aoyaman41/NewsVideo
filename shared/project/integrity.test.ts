import { expect, it } from 'vitest';
import { createNewProject, createNewPart, type Project } from './schema';
import {
  approveAssets,
  deriveIntegrity,
  isVideoCurrent,
  partFreshness,
  videoInput,
} from './integrity';
import { getProjectProgress } from './progress';

function completed(): Project {
  const project = createNewProject('Complete', '/tmp/complete');
  project.article = { title: 'Source', bodyText: 'Source article', importedImages: [] };
  project.parts = [0, 1].map((index) => {
    const part = createNewPart(index);
    part.scriptText = `Narration ${index}`;
    const id = crypto.randomUUID();
    project.images.push({
      id,
      sourceType: 'imported',
      filePath: `/tmp/image-${index}.png`,
      metadata: {
        width: 100,
        height: 100,
        mimeType: 'image/png',
        fileSize: 100,
        createdAt: new Date().toISOString(),
        tags: [],
      },
    });
    part.panelImages = [{ imageId: id }];
    part.audio = {
      id: crypto.randomUUID(),
      filePath: `/tmp/audio-${index}.wav`,
      durationSec: 2,
      ttsEngine: 'macos_tts',
      voiceId: 'test',
      settings: { speakingRate: 1, pitch: 0, languageCode: 'ja-JP' },
      generatedAt: new Date().toISOString(),
    };
    return part;
  });
  project.autoGenerationStatus = {
    running: false,
    lastVideoPath: '/tmp/video.mp4',
    finishedAt: new Date().toISOString(),
  };
  project.integrity = { ...deriveIntegrity(null, project)!, video: videoInput(project) };
  return project;
}

it('marks only the edited scene audio and image stale and invalidates the old final video', () => {
  const before = completed();
  expect(isVideoCurrent(before)).toBe(true);
  const after = structuredClone(before);
  after.parts[0].scriptText = 'Changed narration';
  after.integrity = deriveIntegrity(before, after);
  expect(partFreshness(after, after.parts[0])).toMatchObject({
    script: 'current',
    image: 'stale',
    audio: 'stale',
  });
  expect(partFreshness(after, after.parts[1])).toMatchObject({
    image: 'current',
    audio: 'current',
  });
  expect(isVideoCurrent(after)).toBe(false);
  expect(getProjectProgress(after)).toMatchObject({
    hasVideoOutput: false,
    missingImages: 1,
    missingAudio: 1,
  });
});

it('propagates article, image profile, narration profile and output changes', () => {
  const before = completed();
  const article = structuredClone(before);
  article.article.bodyText = 'New source';
  expect(partFreshness(article, article.parts[0]).script).toBe('stale');
  expect(isVideoCurrent(article)).toBe(false);
  const image = structuredClone(before);
  image.presentationProfile.aspectRatio = '9:16';
  expect(partFreshness(image, image.parts[0])).toMatchObject({ image: 'stale', audio: 'current' });
  const audio = structuredClone(before);
  audio.presentationProfile.ttsNarrationStyleNote = 'Slow';
  expect(partFreshness(audio, audio.parts[0])).toMatchObject({ image: 'current', audio: 'stale' });
  const video = structuredClone(before);
  video.outputSettings = {
    resolution: '1280x720',
    fps: 24,
    videoBitrate: '2M',
    audioBitrate: '128k',
    includeOpening: false,
    includeEnding: false,
  };
  expect(isVideoCurrent(video)).toBe(false);
});

it('preserves explicitly reviewed material but never treats a missing file as current', () => {
  const before = completed();
  const edited = structuredClone(before);
  edited.parts[0].scriptText = 'Updated';
  let approved = approveAssets(edited, edited.parts[0].id, ['image', 'audio']);
  expect(partFreshness(approved, approved.parts[0]).image).toBe('current');
  approved = {
    ...approved,
    integrity: {
      ...approved.integrity!,
      missingFiles: [approved.images[0].filePath, approved.parts[0].audio!.filePath],
    },
  };
  expect(partFreshness(approved, approved.parts[0])).toMatchObject({
    image: 'missing',
    audio: 'missing',
  });
  expect(isVideoCurrent(approved)).toBe(false);
});

it('accepts assigned imported images without demanding AI prompts and treats legacy output as unverified', () => {
  const project = completed();
  expect(getProjectProgress(project)).toMatchObject({ completedSteps: 5, missingPrompts: 0 });
  delete project.integrity;
  expect(isVideoCurrent(project)).toBe(false);
});
