import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNewPart, createNewProject, type Project } from '../../shared/project/schema';
import { approveAssets, partFreshness, sourceInputs } from '../../shared/project/integrity';
import { ProjectRepository } from './repository';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'v1.1-news-broadcast'
);
const FIXTURE_ID = '5b0f6c1e-2d3a-4c5b-8e9f-0a1b2c3d4e5f';

let root: string;
let repository: ProjectRepository;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'newsvideo-legacy-'));
  repository = new ProjectRepository(root);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function installFixture() {
  const directory = path.join(root, `報道サンプル_${FIXTURE_ID.slice(0, 8)}.newsproj`);
  await fs.cp(FIXTURE, directory, { recursive: true });
  return directory;
}

describe('v1.1 projects with the retired image style news_broadcast', () => {
  it('loads instead of being reported as corrupt, reading the style as infographic', async () => {
    const directory = await installFixture();
    const before = await fs.readFile(path.join(directory, 'prompts.json'), 'utf8');

    const project = await repository.load(FIXTURE_ID);

    expect(project.schemaVersion).toBe('v1.1');
    expect(project.prompts.map((prompt) => prompt.stylePreset)).toEqual([
      'infographic',
      'infographic',
    ]);
    expect(project.parts).toHaveLength(2);
    expect(project.presentationProfile.imageStylePreset).toBe('infographic');
    // 過去の使用量に記録された ID(提供終了した preview 版)は書き換えない
    expect(project.usage[0].model).toBe('gemini-3-pro-image-preview');
    // 読み込みだけでは保存しない
    expect(await fs.readFile(path.join(directory, 'prompts.json'), 'utf8')).toBe(before);
    await expect(fs.access(path.join(directory, 'project.previous.json'))).rejects.toThrow();
    expect((await repository.directories()).length).toBe(1);
  });

  it('writes the current value only when the project is saved', async () => {
    const directory = await installFixture();
    const saved = await repository.save(await repository.load(FIXTURE_ID));
    expect(saved.schemaVersion).toBe('v2.0');
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8'));
    expect(manifest.prompts.map((prompt: { stylePreset: string }) => prompt.stylePreset)).toEqual([
      'infographic',
      'infographic',
    ]);
    expect((await repository.load(FIXTURE_ID)).prompts[0].stylePreset).toBe('infographic');
  });
});

describe('generationConfig with a shut-down Gemini preview image model', () => {
  async function createApprovedProject(imageModel: string) {
    const draft = createNewProject('Preview model', '');
    draft.article = { title: 'Source', bodyText: 'Body', importedImages: [] };
    const created = await repository.create(draft);
    const imagePath = path.join(created.path, 'images', 'a.png');
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(imagePath, 'img');
    const now = new Date().toISOString();
    const part = createNewPart(0, { title: 'P1', scriptText: 'Narration' });
    const promptId = crypto.randomUUID();
    const imageId = crypto.randomUUID();
    part.panelImages = [{ imageId }];
    const project: Project = {
      ...created,
      parts: [part],
      prompts: [
        {
          id: promptId,
          partId: part.id,
          stylePreset: 'infographic',
          prompt: 'diagram',
          aspectRatio: '16:9',
          version: 0,
          createdAt: now,
        },
      ],
      images: [
        {
          id: imageId,
          filePath: imagePath,
          sourceType: 'generated',
          metadata: {
            width: 1920,
            height: 1080,
            mimeType: 'image/png',
            fileSize: 3,
            createdAt: now,
            promptId,
            tags: [],
            generation: {
              model: imageModel,
              resolution: 'fhd',
              imageSizeTier: '1K',
              aspectRatio: '16:9',
            },
          },
        },
      ],
      generationConfig: { imageModel, imageResolution: 'fhd' },
    };
    // 旧バージョンが書いた状態を再現する(指紋は保存時の generationConfig から計算される)
    const approved = approveAssets(project, part.id, ['script', 'image']);
    await fs.writeFile(
      path.join(created.path, 'project.json'),
      JSON.stringify({ ...approved, schemaVersion: 'v2.0' })
    );
    return { id: created.id, partId: part.id, imageId };
  }

  it('reads the preview id as the GA id without making existing images stale', async () => {
    const { id, partId, imageId } = await createApprovedProject('gemini-3-pro-image-preview');
    const project = await repository.load(id);
    expect(project.generationConfig?.imageModel).toBe('gemini-3-pro-image');
    const part = project.parts.find((item) => item.id === partId)!;
    expect(partFreshness(project, part).image).toBe('current');
    // 画像メタデータに記録された ID は書き換えない
    expect(project.images.find((image) => image.id === imageId)!.metadata.generation?.model).toBe(
      'gemini-3-pro-image-preview'
    );
  });

  it('gives the same image fingerprint to the preview id and its GA successor', async () => {
    const { id, partId } = await createApprovedProject('gemini-3.1-flash-image-preview');
    const project = await repository.load(id);
    const part = project.parts.find((item) => item.id === partId)!;
    const legacy = {
      ...project,
      generationConfig: { imageModel: 'gemini-3.1-flash-image-preview' },
    };
    const current = { ...project, generationConfig: { imageModel: 'gemini-3.1-flash-image' } };
    const other = { ...project, generationConfig: { imageModel: 'gemini-3-pro-image' } };
    expect(sourceInputs(legacy, part).image).toBe(sourceInputs(current, part).image);
    expect(sourceInputs(other, part).image).not.toBe(sourceInputs(current, part).image);
  });

  it('persists the GA id on the next save', async () => {
    const { id } = await createApprovedProject('gemini-3.1-flash-image-preview');
    const saved = await repository.update(id, () => {});
    expect(saved.generationConfig?.imageModel).toBe('gemini-3.1-flash-image');
    const manifest = JSON.parse(await fs.readFile(path.join(saved.path, 'project.json'), 'utf8'));
    expect(manifest.generationConfig.imageModel).toBe('gemini-3.1-flash-image');
  });
});
