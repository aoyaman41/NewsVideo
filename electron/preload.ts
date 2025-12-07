import { contextBridge, ipcRenderer } from 'electron';

// 許可されたイベントチャンネルの型定義
type AllowedEventChannel =
  | 'progress:update'
  | 'error:occurred'
  | 'render:complete'
  | 'job:statusChange'
  | 'update:available'
  | 'update:progress'
  | 'update:downloaded';

// Renderer プロセスに公開するAPI
contextBridge.exposeInMainWorld('electronAPI', {
  // プロジェクト操作
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    load: (projectId: string) => ipcRenderer.invoke('project:load', projectId),
    save: (project: unknown) => ipcRenderer.invoke('project:save', project),
    delete: (projectId: string) => ipcRenderer.invoke('project:delete', projectId),
    create: (name: string) => ipcRenderer.invoke('project:create', name),
  },

  // 設定操作
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
    getApiKey: (service: string) => ipcRenderer.invoke('settings:getApiKey', service),
    setApiKey: (service: string, apiKey: string) =>
      ipcRenderer.invoke('settings:setApiKey', service, apiKey),
    testConnection: (service: string, apiKey?: string) =>
      ipcRenderer.invoke('settings:testConnection', service, apiKey),
  },

  // AI操作
  ai: {
    generateScript: (article: unknown, options: unknown) =>
      ipcRenderer.invoke('ai:generateScript', article, options),
    generateImagePrompts: (parts: unknown[], stylePreset: string) =>
      ipcRenderer.invoke('ai:generateImagePrompts', parts, stylePreset),
    applyComment: (target: unknown, comment: string) =>
      ipcRenderer.invoke('ai:applyComment', target, comment),
  },

  // 画像生成
  image: {
    generate: (prompt: unknown) => ipcRenderer.invoke('image:generate', prompt),
    generateBatch: (prompts: unknown[]) => ipcRenderer.invoke('image:generateBatch', prompts),
  },

  // TTS操作
  tts: {
    generate: (text: string, options: unknown) =>
      ipcRenderer.invoke('tts:generate', text, options),
    generateBatch: (parts: unknown[], options: unknown) =>
      ipcRenderer.invoke('tts:generateBatch', parts, options),
    getVoices: () => ipcRenderer.invoke('tts:getVoices'),
  },

  // 動画操作
  video: {
    render: (project: unknown, options: unknown) =>
      ipcRenderer.invoke('video:render', project, options),
    preview: (partId: string) => ipcRenderer.invoke('video:preview', partId),
    cancelRender: () => ipcRenderer.invoke('video:cancelRender'),
  },

  // ファイル操作
  file: {
    selectFile: (options: unknown) => ipcRenderer.invoke('file:selectFile', options),
    selectDirectory: () => ipcRenderer.invoke('file:selectDirectory'),
    readFile: (filePath: string) => ipcRenderer.invoke('file:readFile', filePath),
    writeFile: (filePath: string, content: unknown) =>
      ipcRenderer.invoke('file:writeFile', filePath, content),
  },

  // イベント購読（セキュリティ: ホワイトリスト制限）
  events: {
    subscribe: (channel: AllowedEventChannel, callback: (...args: unknown[]) => void) => {
      const ALLOWED_CHANNELS = new Set<AllowedEventChannel>([
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
        return () => {};
      }

      const listener = (_: unknown, ...args: unknown[]) => callback(...args);
      ipcRenderer.on(channel, listener);

      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
});
