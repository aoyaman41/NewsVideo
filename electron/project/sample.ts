import { nativeImage } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectRepository } from './repository';
import { createNewPart, type Project, type AudioAsset } from '../../shared/project/schema';
import { deriveIntegrity, videoInput } from '../../shared/project/integrity';
import { invokeOperation } from '../ipc/operations';
import { measurePcmWav } from '../../shared/project/audioQuality';
import { resolutionForAspect } from '../../shared/project/videoFormat';

export async function populateSample(repo: ProjectRepository, initial: Project) {
  let project = await repo.update(initial.id, (data) => {
    data.name = 'はじめての動画・編集サンプル';
    data.article = {
      title: '記事から動画を作る3ステップ',
      source: 'NewsVideoの操作説明（架空のニュースではありません）',
      bodyText:
        '記事を入力し、シーンを編集して、動画を書き出します。APIキーなしで編集と書き出しを体験できます。',
      importedImages: [],
    };
    data.presentationProfile.closingCardEnabled = true;
    data.presentationProfile.closingCardHeadline = 'あなたの記事で始めましょう';
  });
  const texts = [
    'まず、記事を入力します。このサンプルはAPIキーなしで編集できます。',
    'シーン画面では、原稿と画像を一緒に確認できます。カットを追加して、表示時間を調整しましょう。',
    '最後に映像を確認し、動画を書き出します。用途に合わせて、縦型や正方形にも変更できます。',
  ];
  for (let i = 0; i < texts.length; i++) {
    const bitmap = Buffer.alloc(960 * 540 * 4);
    const colors = [
      [40, 80, 160],
      [25, 140, 130],
      [160, 85, 35],
    ];
    for (let y = 0; y < 540; y++)
      for (let x = 0; x < 960; x++) {
        const at = (y * 960 + x) * 4;
        const bar =
          x > 100 &&
          x < 800 &&
          y > 120 &&
          y < 420 &&
          Math.floor((y - 120) / 60) % 2 === 0 &&
          x < 250 + (Math.floor((y - 120) / 60) + i) * 100;
        const rgb = bar ? [230, 240, 250] : colors[i];
        bitmap[at] = rgb[2];
        bitmap[at + 1] = rgb[1];
        bitmap[at + 2] = rgb[0];
        bitmap[at + 3] = 255;
      }
    const filePath = path.join(project.path, 'images', `sample-${i}.png`);
    await fs.writeFile(
      filePath,
      nativeImage.createFromBitmap(bitmap, { width: 960, height: 540 }).toPNG()
    );
    const result = await invokeOperation<{ audio: AudioAsset }>(
      'tts:generate',
      texts[i],
      {
        ttsEngine: 'macos_tts',
        voiceName: 'Kyoko',
        languageCode: 'ja-JP',
        speakingRate: 1,
        pitch: 0,
      },
      project.id
    );
    result.audio.durationSec = measurePcmWav(await fs.readFile(result.audio.filePath)).durationSec;
    const id = crypto.randomUUID();
    project = await repo.update(project.id, (data) => {
      data.images.push({
        id,
        filePath,
        sourceType: 'imported',
        rights: {
          origin: 'shot',
          terms: 'NewsVideoに同梱された自作の幾何学図形。アプリと同じライセンス。',
          attribution: 'NewsVideo',
        },
        metadata: {
          width: 960,
          height: 540,
          mimeType: 'image/png',
          fileSize: bitmap.length,
          createdAt: new Date().toISOString(),
          tags: ['sample'],
        },
      });
      data.parts.push(
        createNewPart(i, {
          title: ['記事を入力', 'シーンを編集', '映像を確認'][i],
          scriptText: texts[i],
          durationEstimateSec: result.audio.durationSec,
          panelImages: [{ imageId: id }],
          audio: result.audio,
        })
      );
      data.audio.push(result.audio);
    });
  }
  project.integrity = deriveIntegrity(null, project);
  project = await repo.save(project);
  const options = {
    resolution: resolutionForAspect('1280x720', project.presentationProfile.aspectRatio),
    fps: 24,
    videoBitrate: '3M',
    audioBitrate: '128k',
    includeOpening: false,
    includeEnding: false,
  };
  const outputPath = path.join(project.path, 'output', 'sample.mp4');
  project = await repo.update(project.id, (data) => {
    data.outputSettings = options;
  });
  await invokeOperation('video:render', project, options, outputPath);
  return repo.update(project.id, (data) => {
    data.autoGenerationStatus = {
      running: false,
      lastVideoPath: outputPath,
      finishedAt: new Date().toISOString(),
    };
    data.integrity = { ...data.integrity!, video: videoInput(data) };
  });
}
