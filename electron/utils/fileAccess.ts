import * as fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

type Grant = { path: string; write: boolean; directory: boolean };
const within = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

async function canonical(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await canonical(parent), path.basename(file));
  }
}

export class FileAccessPolicy {
  private grants: Grant[] | null = null;
  private loading?: Promise<Grant[]>;
  private saving: Promise<void> = Promise.resolve();
  constructor(
    private roots: string[],
    private ledger: string
  ) {}

  private async load() {
    if (this.grants) return this.grants;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(this.ledger, 'utf8'));
        this.grants = Array.isArray(parsed)
          ? parsed.filter(
              (item): item is Grant =>
                item &&
                typeof item.path === 'string' &&
                typeof item.write === 'boolean' &&
                typeof item.directory === 'boolean'
            )
          : [];
      } catch {
        this.grants = [];
      }
      return this.grants;
    })();
    return this.loading;
  }

  async grant(file: string, write: boolean, directory = false) {
    const target = await canonical(path.resolve(file));
    const grants = await this.load();
    const existing = grants.find((item) => item.path === target && item.directory === directory);
    if (existing) existing.write ||= write;
    else grants.push({ path: target, write, directory });
    const save = this.saving
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.ledger), { recursive: true });
        const temp = `${this.ledger}.tmp`;
        await fs.writeFile(temp, JSON.stringify(grants), { mode: 0o600 });
        await fs.rename(temp, this.ledger);
      });
    this.saving = save;
    await save;
  }

  async assert(file: unknown, write = false): Promise<string> {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0'))
      throw new Error('絶対パスのファイルを指定してください。');
    const target = await canonical(file);
    for (const root of this.roots) if (within(await canonical(root), target)) return target;
    for (const grant of await this.load()) {
      if (write && !grant.write) continue;
      if (grant.directory ? within(grant.path, target) : grant.path === target) return target;
    }
    throw new Error(
      'このファイルへのアクセスは許可されていません。ファイル選択画面から指定してください。'
    );
  }

  async media(file: unknown, write = false) {
    const target = await this.assert(file, write);
    if (!/\.(png|jpe?g|gif|webp|avif|mp4|mov|m4v|webm|wav|mp3|m4a|aiff?|flac|ogg)$/i.test(target))
      throw new Error('許可されていないメディア形式です。');
    return target;
  }
}

let policy: FileAccessPolicy | undefined;
export function fileAccess() {
  policy ??= new FileAccessPolicy(
    [path.join(app.getPath('userData'), 'projects'), path.join(app.getPath('userData'), 'trash')],
    path.join(app.getPath('userData'), 'file-grants.json')
  );
  return policy;
}
