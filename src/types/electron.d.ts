// Electron API の型定義

type AllowedEventChannel =
  | 'progress:update'
  | 'error:occurred'
  | 'render:complete'
  | 'job:statusChange'
  | 'update:available'
  | 'update:progress'
  | 'update:downloaded';

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: 'openai' | 'gemini';
};

interface ElectronAPI {
  project: {
    list: () => Promise<ProjectListItem[]>;
    load: (projectId: string) => Promise<Project>;
    save: (project: Project) => Promise<{ success: boolean; savedAt: string }>;
    delete: (projectId: string) => Promise<{ success: boolean }>;
    create: (name: string) => Promise<ProjectMeta>;
  };

  settings: {
    get: () => Promise<Settings>;
    set: (settings: Partial<Settings>) => Promise<{ success: boolean }>;
    getApiKey: (service: ApiKeyService) => Promise<string | null>;
    setApiKey: (service: ApiKeyService, apiKey: string) => Promise<{ success: boolean }>;
    testConnection: (
      service: ApiKeyService,
      apiKey?: string
    ) => Promise<{ success: boolean; message: string; latencyMs?: number }>;
  };

  ai: {
    generateScript: (
      article: Article,
      options: ScriptOptions
    ) => Promise<{ parts: Part[]; usage?: TokenUsage | null }>;
    generateImagePrompts: (
      parts: Part[],
      article: Article,
      stylePreset: string
    ) => Promise<{ prompts: ImagePrompt[]; usage?: TokenUsage | null }>;
    generateImagePromptForTarget: (
      parts: Part[],
      article: Article,
      targetId: string
    ) => Promise<{ prompt: ImagePrompt; usage?: TokenUsage | null }>;
    applyComment: (
      target: CommentTarget,
      comment: string
    ) => Promise<{ text: string; usage?: TokenUsage | null }>;
  };

  image: {
    generate: (prompt: ImagePrompt, projectId: string) => Promise<ImageAsset>;
    generateBatch: (prompts: ImagePrompt[], projectId: string) => Promise<ImageAsset[]>;
    delete: (filePath: string) => Promise<{ success: boolean }>;
    import: (sourcePath: string, projectId: string) => Promise<ImageAsset>;
  };

  tts: {
    generate: (
      text: string,
      options: TTSOptions,
      projectId: string
    ) => Promise<{ audio: AudioAsset; usage?: TokenUsage | null }>;
    generateBatch: (
      parts: Part[],
      options: TTSOptions,
      projectId: string
    ) => Promise<Array<{ audio: AudioAsset; usage?: TokenUsage | null }>>;
    getVoices: (engine?: 'google_tts' | 'gemini_tts' | 'macos_tts') => Promise<VoiceInfo[]>;
  };

  video: {
    render: (
      project: Project,
      options: RenderOptions,
      outputPath: string
    ) => Promise<{ outputPath: string }>;
    preview: (partId: string) => Promise<{ previewPath: string }>;
    cancelRender: () => Promise<{ success: boolean }>;
  };

  file: {
    selectFile: (options: FileDialogOptions) => Promise<string | null>;
    selectDirectory: () => Promise<string | null>;
    readFile: (filePath: string) => Promise<Buffer>;
    writeFile: (filePath: string, content: Buffer) => Promise<{ success: boolean }>;
    exists: (filePath: string) => Promise<boolean>;
    listFiles: (dirPath: string) => Promise<FileEntry[]>;
    revealInFinder: (targetPath: string) => Promise<{ success: boolean }>;
  };

  events: {
    subscribe: (channel: AllowedEventChannel, callback: (...args: unknown[]) => void) => () => void;
  };
}

// プロジェクト関連の型
interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  path: string;
}

type WorkflowStage = 'article' | 'script' | 'image' | 'audio' | 'video';

interface ProjectProgressSummary {
  stage: WorkflowStage;
  completedSteps: number;
  totalSteps: 5;
  partCount: number;
  missingPrompts: number;
  missingImages: number;
  missingAudio: number;
  hasVideoOutput: boolean;
}

interface ProjectListItem extends ProjectMeta {
  articleTitle?: string;
  thumbnailImageId?: string;
  summary?: ProjectProgressSummary;
}

interface Project extends ProjectMeta {
  schemaVersion: string;
  article: Article;
  parts: Part[];
  images: ImageAsset[];
  prompts: ImagePrompt[];
  audio: AudioAsset[];
  usage: UsageRecord[];
  thumbnail?: ImageAssetRef;
  autoGenerationStatus?: AutoGenerationStatus;
}

interface Article {
  title: string;
  source?: string;
  bodyText: string;
  importedImages: ImageAsset[];
}

interface Part {
  id: string;
  index: number;
  title: string;
  summary: string;
  scriptText: string;
  durationEstimateSec: number;
  panelImages: ImageAssetRef[];
  comments: Comment[];
  audio?: AudioAsset;
  createdAt: string;
  updatedAt: string;
  scriptGeneratedAt: string;
  scriptModifiedByUser: boolean;
}

interface ImageAsset {
  id: string;
  filePath: string;
  sourceType: 'generated' | 'imported';
  metadata: {
    width: number;
    height: number;
    mimeType: string;
    fileSize: number;
    createdAt: string;
    promptId?: string;
    tags: string[];
  };
}

interface UsageRecord {
  id: string;
  provider: 'openai' | 'gemini';
  category: 'text' | 'image' | 'tts';
  model: string;
  operation: string;
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  createdAt: string;
}

interface AutoGenerationStatus {
  running: boolean;
  step?: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  cancelRequested?: boolean;
  error?: string;
  steps?: {
    script?: boolean;
    prompts?: boolean;
    images?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  lastVideoPath?: string;
}

interface ImageAssetRef {
  imageId: string;
  displayDurationSec?: number;
}

interface ImagePrompt {
  id: string;
  partId: string;
  stylePreset: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '16:9' | '1:1' | '9:16';
  version: number;
  createdAt: string;
}

interface AudioAsset {
  id: string;
  filePath: string;
  durationSec: number;
  ttsEngine: 'google_tts' | 'gemini_tts' | 'macos_tts';
  voiceId: string;
  segments?: string[];
  timepoints?: Array<{
    markName: string;
    timeSeconds: number;
  }>;
  settings: {
    speakingRate: number;
    pitch: number;
    languageCode: string;
  };
  generatedAt: string;
}

interface Comment {
  id: string;
  text: string;
  createdAt: string;
  appliedAt?: string;
}

// 設定関連の型
interface Settings {
  ttsEngine: 'google_tts' | 'gemini_tts' | 'macos_tts';
  ttsVoice: string;
  ttsSpeakingRate: number;
  ttsPitch: number;
  scriptTextModel: 'gpt-5.2' | 'gemini-3.1-pro';
  imagePromptTextModel: 'gpt-5.2' | 'gemini-3.1-pro';
  imageStylePreset: string;
  imageModel: 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
  imageResolution: 'fhd' | '2k' | '4k';
  defaultAspectRatio: '16:9' | '1:1' | '9:16';
  videoResolution: '1920x1080' | '1280x720' | '3840x2160';
  videoFps: number;
  videoBitrate: string;
  audioBitrate: string;
  videoPartLeadInSec: number;
  openingVideoPath: string;
  endingVideoPath: string;
  autoSaveInterval: number;
  defaultProjectDir: string;
  cost?: CostRates;
}

type ApiKeyService = 'openai' | 'google_ai' | 'google_tts';

// その他の型
interface ScriptOptions {
  targetPartCount?: number;
  tone?: 'formal' | 'casual' | 'news';
  targetDurationPerPartSec?: number;
}

interface CommentTarget {
  type: 'script' | 'imagePrompt';
  id: string;
  currentText: string;
}

interface TTSOptions {
  ttsEngine: 'google_tts' | 'gemini_tts' | 'macos_tts';
  voiceName: string;
  languageCode: string;
  speakingRate: number;
  pitch: number;
  audioEncoding: 'MP3' | 'LINEAR16';
}

interface VoiceInfo {
  name: string;
  languageCodes: string[];
  gender: 'MALE' | 'FEMALE' | 'NEUTRAL';
  sampleRateHertz: number;
}

interface CostRates {
  currency: 'USD';
  openai: {
    model: string;
    inputPer1MTokensUsd: number;
    outputPer1MTokensUsd: number;
  };
  gemini: {
    ttsModel: string;
    ttsInputPer1MTokensUsd: number;
    ttsOutputPer1MTokensUsd: number;
    imageModel: string;
    imageRatesByModel: Record<
      string,
      {
        inputPerImageUsd: number;
        outputPerImageUsd: number;
      }
    >;
    imageInputPerImageUsd?: number;
    imageOutputPerImageUsd?: number;
  };
}

interface RenderOptions {
  resolution: '1920x1080' | '1280x720' | '3840x2160';
  fps: number;
  videoBitrate: string;
  audioBitrate: string;
  includeOpening: boolean;
  includeEnding: boolean;
}

interface FileDialogOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
}

interface FileEntry {
  path: string;
  name: string;
  isFile: boolean;
  mtimeMs: number;
}

// グローバル型定義
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
