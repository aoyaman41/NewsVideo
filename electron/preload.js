import { contextBridge, ipcRenderer } from 'electron';
// Renderer プロセスに公開するAPI
contextBridge.exposeInMainWorld('electronAPI', {
    // プロジェクト操作
    project: {
        list: () => ipcRenderer.invoke('project:list'),
        load: (projectId) => ipcRenderer.invoke('project:load', projectId),
        save: (project) => ipcRenderer.invoke('project:save', project),
        delete: (projectId) => ipcRenderer.invoke('project:delete', projectId),
        create: (name) => ipcRenderer.invoke('project:create', name),
    },
    // 設定操作
    settings: {
        get: () => ipcRenderer.invoke('settings:get'),
        set: (settings) => ipcRenderer.invoke('settings:set', settings),
        getApiKey: (service) => ipcRenderer.invoke('settings:getApiKey', service),
        setApiKey: (service, apiKey) => ipcRenderer.invoke('settings:setApiKey', service, apiKey),
        testConnection: (service, apiKey) => ipcRenderer.invoke('settings:testConnection', service, apiKey),
    },
    // AI操作
    ai: {
        generateScript: (article, options) => ipcRenderer.invoke('ai:generateScript', article, options),
        generateImagePrompts: (parts, article, stylePreset) => ipcRenderer.invoke('ai:generateImagePrompts', parts, article, stylePreset),
        applyComment: (target, comment) => ipcRenderer.invoke('ai:applyComment', target, comment),
    },
    // 画像生成
    image: {
        generate: (prompt, projectId) => ipcRenderer.invoke('image:generate', prompt, projectId),
        generateBatch: (prompts, projectId) => ipcRenderer.invoke('image:generateBatch', prompts, projectId),
    },
    // TTS操作
    tts: {
        generate: (text, options, projectId) => ipcRenderer.invoke('tts:generate', text, options, projectId),
        generateBatch: (parts, options, projectId) => ipcRenderer.invoke('tts:generateBatch', parts, options, projectId),
        getVoices: (engine) => ipcRenderer.invoke('tts:getVoices', engine),
    },
    // 動画操作
    video: {
        render: (project, options, outputPath) => ipcRenderer.invoke('video:render', project, options, outputPath),
        preview: (partId) => ipcRenderer.invoke('video:preview', partId),
        cancelRender: () => ipcRenderer.invoke('video:cancelRender'),
    },
    // ファイル操作
    file: {
        selectFile: (options) => ipcRenderer.invoke('file:selectFile', options),
        selectDirectory: () => ipcRenderer.invoke('file:selectDirectory'),
        readFile: (filePath) => ipcRenderer.invoke('file:readFile', filePath),
        writeFile: (filePath, content) => ipcRenderer.invoke('file:writeFile', filePath, content),
    },
    // イベント購読（セキュリティ: ホワイトリスト制限）
    events: {
        subscribe: (channel, callback) => {
            const ALLOWED_CHANNELS = new Set([
                'progress:update',
                'error:occurred',
                'render:complete',
                'job:statusChange',
                'update:available',
                'update:progress',
                'update:downloaded',
            ]);
            if (!ALLOWED_CHANNELS.has(channel)) {
                console.warn(`Blocked subscription to unauthorized channel: ${channel}`);
                return () => { };
            }
            const listener = (_, ...args) => callback(...args);
            ipcRenderer.on(channel, listener);
            return () => ipcRenderer.removeListener(channel, listener);
        },
    },
});
