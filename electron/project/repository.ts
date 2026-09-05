import { metricsSchema } from '../../shared/project/metrics';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { deriveIntegrity } from '../../shared/project/integrity';
import { projectSchema, type Project } from '../../shared/project/schema';
import { normalizePresentationProfile } from '../../shared/project/presentationProfile';

export class ProjectStorageError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'CORRUPT' | 'UNSUPPORTED_VERSION' | 'CONFLICT',
    message: string
  ) {
    super(`[${code}] ${message}`);
  }
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** A single durable manifest is the commit point. Legacy component JSON files are read only. */
export class ProjectRepository {
  private queues = new Map<string, Promise<unknown>>();
  constructor(readonly root: string) {}

  async directories() {
    await fs.mkdir(this.root, { recursive: true });
    return (await fs.readdir(this.root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('.newsproj'))
      .map((entry) => path.join(this.root, entry.name));
  }

  async resolve(id: string): Promise<string> {
    for (const directory of await this.directories()) {
      // The directory retains a full UUID for new projects; legacy projects use its prefix.
      if (path.basename(directory).endsWith(`${id}.newsproj`)) return directory;
      for (const filename of ['project.json', 'project.previous.json']) {
        try {
          const data = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'));
          if (data.id === id) return directory;
        } catch {
          /* Inspect the backup before diagnosing the selected project. */
        }
      }
      if (path.basename(directory).endsWith(`_${id.slice(0, 8)}.newsproj`)) return directory;
    }
    throw new ProjectStorageError('NOT_FOUND', 'プロジェクトが見つかりません。');
  }

  private async decode(directory: string, filename: string): Promise<Project> {
    const meta = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'));
    if (!['v1.0', 'v1.1', 'v1.2', 'v2.0'].includes(meta.schemaVersion)) {
      throw new ProjectStorageError(
        'UNSUPPORTED_VERSION',
        `未対応の保存形式です: ${meta.schemaVersion}`
      );
    }
    let data = meta;
    if (meta.schemaVersion !== 'v2.0') {
      const fields = ['article', 'parts', 'images', 'prompts', 'audio', 'usage'] as const;
      const values = await Promise.all(
        fields.map(async (field) => {
          try {
            return JSON.parse(await fs.readFile(path.join(directory, `${field}.json`), 'utf8'));
          } catch (error) {
            if (field === 'usage' && missing(error)) return [];
            throw error;
          }
        })
      );
      data = { ...meta, ...Object.fromEntries(fields.map((field, i) => [field, values[i]])) };
    }
    const project = projectSchema.parse({
      ...data,
      revision: data.revision ?? 0,
      path: directory,
      presentationProfile: normalizePresentationProfile(data.presentationProfile),
    });
    const files = [
      ...project.images,
      ...project.article.importedImages,
      ...project.audio,
      ...project.parts.flatMap((part) => (part.audio ? [part.audio] : [])),
    ].map((asset) => asset.filePath);
    if (project.autoGenerationStatus?.lastVideoPath)
      files.push(project.autoGenerationStatus.lastVideoPath);
    const missingFiles = (
      await Promise.all(
        [...new Set(files)].map(async (file) => {
          try {
            await fs.access(file);
            return null;
          } catch {
            return file;
          }
        })
      )
    ).filter((file): file is string => file !== null);
    project.integrity = {
      ...project.integrity,
      parts: project.integrity?.parts ?? {},
      missingFiles,
    };
    return project;
  }

  async readDirectory(directory: string): Promise<Project> {
    try {
      return await this.decode(directory, 'project.json');
    } catch (error) {
      if (error instanceof ProjectStorageError) throw error;
      try {
        return await this.decode(directory, 'project.previous.json');
      } catch (backupError) {
        if (backupError instanceof ProjectStorageError) throw backupError;
        throw new ProjectStorageError(
          'CORRUPT',
          '保存データを読み込めません。バックアップを復元してください。'
        );
      }
    }
  }

  async load(id: string) {
    return this.readDirectory(await this.resolve(id));
  }

  private serial<T>(id: string, run: () => Promise<T>): Promise<T> {
    const operation = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
    this.queues.set(id, operation);
    void operation
      .finally(() => {
        if (this.queues.get(id) === operation) this.queues.delete(id);
      })
      .catch(() => {});
    return operation;
  }

  async drain() {
    await Promise.allSettled([...this.queues.values()]);
  }

  private async atomicWrite(filename: string, data: string) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(data, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, filename);
      const directory = await fs.open(path.dirname(filename), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async create(input: Project) {
    const directory = path.join(this.root, `${input.id}.newsproj`);
    await fs.mkdir(directory, { recursive: true });
    for (const folder of ['images/imported', 'audio', 'output'])
      await fs.mkdir(path.join(directory, folder), { recursive: true });
    const project = projectSchema.parse({
      ...input,
      path: directory,
      schemaVersion: 'v2.0',
      revision: 0,
    });
    await this.atomicWrite(path.join(directory, 'project.json'), JSON.stringify(project));
    return project;
  }

  async save(input: unknown): Promise<Project> {
    const requested = projectSchema.parse(input);
    return this.serial(requested.id, async () => {
      const directory = await this.resolve(requested.id);
      const current = await this.readDirectory(directory);
      if ((requested.revision ?? 0) !== (current.revision ?? 0)) {
        throw new ProjectStorageError(
          'CONFLICT',
          '別の保存が先に完了しました。未保存の編集を保ったまま再読み込みして差分を確認してください。'
        );
      }
      return this.persist(current, requested, directory);
    });
  }
  async update(id: string, mutate: (project: Project) => void): Promise<Project> {
    return this.serial(id, async () => {
      const directory = await this.resolve(id);
      const current = await this.readDirectory(directory);
      const requested = structuredClone(current);
      mutate(requested);
      return this.persist(current, projectSchema.parse(requested), directory);
    });
  }

  private async persist(current: Project, requested: Project, directory: string): Promise<Project> {
    const next = {
      ...requested,
      path: directory,
      schemaVersion: 'v2.0',
      revision: (current.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    next.integrity = deriveIntegrity(current, next);
    next.metrics = metricsSchema.parse(next.metrics ?? {});
    if (next.job?.id !== current.job?.id && current.job) next.metrics.restarts++;
    if (next.job?.status === 'cancelled' && current.job?.status !== 'cancelled')
      next.metrics.stops++;
    if (next.job?.status === 'failed') next.metrics.lastFailureKind = next.job.error?.kind;
    // Materialize legacy data as a complete backup before changing the commit point.
    await this.atomicWrite(
      path.join(directory, 'project.previous.json'),
      JSON.stringify({ ...current, schemaVersion: 'v2.0' })
    );
    await this.atomicWrite(path.join(directory, 'project.json'), JSON.stringify(next));
    return next;
  }
}
