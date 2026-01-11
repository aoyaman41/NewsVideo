import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
// プロジェクトの保存先ディレクトリ
const getProjectsDir = () => path.join(app.getPath('userData'), 'projects');
// プロジェクト一覧取得
ipcMain.handle('project:list', async () => {
    const projectsDir = getProjectsDir();
    try {
        await fs.mkdir(projectsDir, { recursive: true });
        const entries = await fs.readdir(projectsDir, { withFileTypes: true });
        const projects = [];
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.endsWith('.newsproj')) {
                const projectPath = path.join(projectsDir, entry.name);
                const metaPath = path.join(projectPath, 'project.json');
                try {
                    const metaContent = await fs.readFile(metaPath, 'utf-8');
                    const meta = JSON.parse(metaContent);
                    projects.push({
                        id: meta.id,
                        name: meta.name,
                        createdAt: meta.createdAt,
                        updatedAt: meta.updatedAt,
                        path: projectPath,
                    });
                }
                catch {
                    // メタファイルが読めない場合はスキップ
                }
            }
        }
        // 更新日時の降順でソート
        projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return projects;
    }
    catch (error) {
        console.error('Failed to list projects:', error);
        return [];
    }
});
// プロジェクト作成
ipcMain.handle('project:create', async (_, name) => {
    try {
        console.log('[project:create] Creating project:', name);
        const projectsDir = getProjectsDir();
        console.log('[project:create] Projects dir:', projectsDir);
        await fs.mkdir(projectsDir, { recursive: true });
        const id = randomUUID();
        const now = new Date().toISOString();
        const projectDirName = `${name.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_')}_${id.slice(0, 8)}.newsproj`;
        const projectPath = path.join(projectsDir, projectDirName);
        // プロジェクトディレクトリ構造を作成
        await fs.mkdir(projectPath, { recursive: true });
        await fs.mkdir(path.join(projectPath, 'images', 'imported'), { recursive: true });
        await fs.mkdir(path.join(projectPath, 'audio'), { recursive: true });
        await fs.mkdir(path.join(projectPath, 'output'), { recursive: true });
        // プロジェクトメタデータ
        const projectMeta = {
            id,
            name,
            schemaVersion: 'v1.1',
            createdAt: now,
            updatedAt: now,
        };
        // 空の記事データ
        const article = {
            title: '',
            source: '',
            bodyText: '',
            importedImages: [],
        };
        // 初期ファイルを保存
        await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(projectMeta, null, 2));
        await fs.writeFile(path.join(projectPath, 'article.json'), JSON.stringify(article, null, 2));
        await fs.writeFile(path.join(projectPath, 'parts.json'), JSON.stringify([], null, 2));
        await fs.writeFile(path.join(projectPath, 'images.json'), JSON.stringify([], null, 2));
        await fs.writeFile(path.join(projectPath, 'prompts.json'), JSON.stringify([], null, 2));
        await fs.writeFile(path.join(projectPath, 'audio.json'), JSON.stringify([], null, 2));
        await fs.writeFile(path.join(projectPath, 'usage.json'), JSON.stringify([], null, 2));
        console.log('[project:create] Project created successfully:', id);
        return {
            id,
            name,
            createdAt: now,
            updatedAt: now,
            path: projectPath,
        };
    }
    catch (error) {
        console.error('[project:create] Error:', error);
        throw error;
    }
});
// プロジェクト読み込み
ipcMain.handle('project:load', async (_, projectId) => {
    const projectsDir = getProjectsDir();
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.endsWith('.newsproj')) {
            const projectPath = path.join(projectsDir, entry.name);
            const metaPath = path.join(projectPath, 'project.json');
            try {
                const metaContent = await fs.readFile(metaPath, 'utf-8');
                const meta = JSON.parse(metaContent);
                if (meta.id === projectId) {
                    // 全データを読み込み
                    const [article, parts, images, prompts, audio, usage] = await Promise.all([
                        fs.readFile(path.join(projectPath, 'article.json'), 'utf-8').then(JSON.parse),
                        fs.readFile(path.join(projectPath, 'parts.json'), 'utf-8').then(JSON.parse),
                        fs.readFile(path.join(projectPath, 'images.json'), 'utf-8').then(JSON.parse),
                        fs.readFile(path.join(projectPath, 'prompts.json'), 'utf-8').then(JSON.parse),
                        fs.readFile(path.join(projectPath, 'audio.json'), 'utf-8').then(JSON.parse),
                        fs.readFile(path.join(projectPath, 'usage.json'), 'utf-8')
                            .then(JSON.parse)
                            .catch(() => []),
                    ]);
                    return {
                        ...meta,
                        path: projectPath,
                        article,
                        parts,
                        images,
                        prompts,
                        audio,
                        usage,
                    };
                }
            }
            catch {
                // 読み込み失敗時はスキップ
            }
        }
    }
    throw new Error(`Project not found: ${projectId}`);
});
// プロジェクト保存
ipcMain.handle('project:save', async (_, project) => {
    const now = new Date().toISOString();
    const projectPath = project.path;
    if (!projectPath) {
        throw new Error('Project path is missing');
    }
    const safeArticle = project.article ?? {
        title: '',
        source: '',
        bodyText: '',
        importedImages: [],
    };
    const safeParts = project.parts ?? [];
    const safeImages = project.images ?? [];
    const safePrompts = project.prompts ?? [];
    const safeAudio = project.audio ?? [];
    const safeUsage = project.usage ?? [];
    // メタデータ更新
    const metaPath = path.join(projectPath, 'project.json');
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent);
    meta.name = project.name;
    meta.updatedAt = now;
    meta.thumbnail = project.thumbnail;
    meta.autoGenerationStatus = project.autoGenerationStatus;
    // 全データを保存
    await Promise.all([
        fs.writeFile(metaPath, JSON.stringify(meta, null, 2)),
        fs.writeFile(path.join(projectPath, 'article.json'), JSON.stringify(safeArticle, null, 2)),
        fs.writeFile(path.join(projectPath, 'parts.json'), JSON.stringify(safeParts, null, 2)),
        fs.writeFile(path.join(projectPath, 'images.json'), JSON.stringify(safeImages, null, 2)),
        fs.writeFile(path.join(projectPath, 'prompts.json'), JSON.stringify(safePrompts, null, 2)),
        fs.writeFile(path.join(projectPath, 'audio.json'), JSON.stringify(safeAudio, null, 2)),
        fs.writeFile(path.join(projectPath, 'usage.json'), JSON.stringify(safeUsage, null, 2)),
    ]);
    return { success: true, savedAt: now };
});
// プロジェクト削除
ipcMain.handle('project:delete', async (_, projectId) => {
    const projectsDir = getProjectsDir();
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.endsWith('.newsproj')) {
            const projectPath = path.join(projectsDir, entry.name);
            const metaPath = path.join(projectPath, 'project.json');
            try {
                const metaContent = await fs.readFile(metaPath, 'utf-8');
                const meta = JSON.parse(metaContent);
                if (meta.id === projectId) {
                    await fs.rm(projectPath, { recursive: true });
                    return { success: true };
                }
            }
            catch {
                // 読み込み失敗時はスキップ
            }
        }
    }
    throw new Error(`Project not found: ${projectId}`);
});
