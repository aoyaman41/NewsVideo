import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectRepository } from './repository';
import { projectSchema, createNewProject, type Project } from '../../shared/project/schema';

function mapPaths<T>(value: T, transform: (file: string) => string): T {
  if (Array.isArray(value)) return value.map((item) => mapPaths(item, transform)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      ['filePath', 'lastVideoPath', 'openingVideoPath', 'endingVideoPath'].includes(key) &&
      typeof item === 'string' &&
      item
        ? transform(item)
        : mapPaths(item, transform),
    ])
  ) as T;
}
function allPaths(project: Project) {
  const result = new Set<string>();
  mapPaths(project, (file) => {
    if (file) result.add(file);
    return file;
  });
  return [...result];
}

export class ProjectLifecycle {
  constructor(
    private repo: ProjectRepository,
    private authorize: (file: string) => Promise<string>
  ) {}
  async clone(id: string, template = false) {
    const source = await this.repo.load(id);
    if (source.job && ['running', 'queued'].includes(source.job.status))
      throw new Error('生成を停止してから複製してください。');
    const target = createNewProject(`${source.name}${template ? ' テンプレート' : ' コピー'}`, '');
    const data = template
      ? {
          ...target,
          presentationProfile: { ...source.presentationProfile, styleReferenceImageIds: [] },
          outputSettings: source.outputSettings,
          generationConfig: source.generationConfig,
          template: true,
        }
      : {
          ...source,
          ...target,
          article: source.article,
          parts: source.parts,
          prompts: source.prompts,
          images: source.images,
          audio: source.audio,
          presentationProfile: source.presentationProfile,
          outputSettings: source.outputSettings,
          generationConfig: source.generationConfig,
        };
    return this.copyIntoNew(
      { ...data, job: undefined, jobHistory: undefined, autoGenerationStatus: undefined, template },
      (file) => this.authorize(file)
    );
  }
  private async copyIntoNew(project: Project, resolve: (file: string) => Promise<string>) {
    const directory = path.join(this.repo.root, `${project.id}.newsproj`);
    const staging = `${directory}.importing-${randomUUID()}`;
    const mapped = new Map<string, string>();
    try {
      await fs.mkdir(path.join(staging, 'assets'), { recursive: true });
      for (const file of allPaths(project)) {
        const original = await resolve(file);
        const name = `${randomUUID()}${path.extname(original)}`;
        await fs.copyFile(original, path.join(staging, 'assets', name));
        mapped.set(file, path.join(directory, 'assets', name));
      }
      const data = projectSchema.parse({
        ...mapPaths(project, (file) => mapped.get(file) ?? file),
        path: directory,
        schemaVersion: 'v2.0',
        revision: 0,
        job: undefined,
        jobHistory: undefined,
        integrity: undefined,
        autoGenerationStatus: undefined,
        usage: [],
        archived: false,
      });
      await fs.writeFile(path.join(staging, 'project.json'), JSON.stringify(data), { mode: 0o600 });
      await fs.mkdir(this.repo.root, { recursive: true });
      await fs.rename(staging, directory);
      return data;
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  async export(id: string, destination: string) {
    const project = await this.repo.load(id);
    if (project.job && ['running', 'queued'].includes(project.job.status))
      throw new Error('生成を停止してからバックアップしてください。');
    // Job output logs may contain obsolete paths. The portable bundle contains the editable project and active assets.
    const portable = { ...project, job: undefined, jobHistory: undefined };
    const directory = path.join(destination, `${project.id}-${Date.now()}.newsbackup`);
    const staging = `${directory}.tmp`;
    const mapped = new Map<string, string>();
    try {
      await fs.mkdir(path.join(staging, 'assets'), { recursive: true });
      for (const file of allPaths(portable)) {
        const original = await this.authorize(file);
        const relative = `assets/${randomUUID()}${path.extname(original)}`;
        await fs.copyFile(original, path.join(staging, relative));
        mapped.set(file, relative);
      }
      await fs.writeFile(
        path.join(staging, 'backup.json'),
        JSON.stringify({
          version: 1,
          project: { ...mapPaths(portable, (file) => mapped.get(file) ?? file), path: '.' },
        }),
        { mode: 0o600 }
      );
      await fs.rename(staging, directory);
      return directory;
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  async import(directory: string) {
    const root = await fs.realpath(directory);
    const manifest = await fs.realpath(path.join(root, 'backup.json'));
    if (path.dirname(manifest) !== root) throw new Error('バックアップの範囲外を参照しています。');
    const parsed = JSON.parse(await fs.readFile(manifest, 'utf8'));
    if (parsed.version !== 1) throw new Error('未対応のバックアップ形式です。');
    const project = projectSchema.parse(parsed.project);
    const now = new Date().toISOString();
    return this.copyIntoNew(
      {
        ...project,
        id: randomUUID(),
        name: `${project.name} 復元`,
        createdAt: now,
        updatedAt: now,
      },
      async (file) => {
        if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))
          throw new Error('バックアップに不正なパスがあります。');
        const resolved = await fs.realpath(path.join(root, file));
        const relative = path.relative(root, resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative))
          throw new Error('バックアップの範囲外を参照しています。');
        return resolved;
      }
    );
  }
  async trash() {
    const root = path.join(path.dirname(this.repo.root), 'trash');
    await fs.mkdir(root, { recursive: true });
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('.newsproj'))
      .map((entry) => ({ key: entry.name, name: entry.name }));
  }
  async restore(key: string) {
    if (!/^[0-9]+-[^/\\]+\.newsproj$/.test(key)) throw new Error('不正なごみ箱項目です。');
    const directory = path.join(path.dirname(this.repo.root), 'trash', key);
    const project = await this.repo.readDirectory(directory);
    const original = path.join(this.repo.root, key.replace(/^[0-9]+-/, ''));
    const target = path.join(this.repo.root, `${project.id}.newsproj`);
    try {
      await fs.access(target);
      throw new Error('同じIDのプロジェクトが存在します。');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.rename(directory, target);
    const restored = await this.repo.load(project.id);
    return this.repo.save(
      mapPaths(restored, (file) =>
        file.startsWith(`${original}${path.sep}`)
          ? path.join(target, path.relative(original, file))
          : file
      )
    );
  }
}
