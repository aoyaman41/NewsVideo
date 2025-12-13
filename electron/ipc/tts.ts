import { app, ipcMain, safeStorage } from 'electron';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);

type TTSEngine = 'google_tts' | 'gemini_tts' | 'macos_tts';

interface TTSOptions {
  ttsEngine: TTSEngine;
  voiceName: string;
  languageCode: string;
  speakingRate: number;
  pitch: number;
  audioEncoding: 'MP3' | 'LINEAR16';
}

interface AudioAsset {
  id: string;
  filePath: string;
  durationSec: number;
  ttsEngine: TTSEngine;
  voiceId: string;
  settings: {
    speakingRate: number;
    pitch: number;
    languageCode: string;
  };
  generatedAt: string;
}

interface VoiceInfo {
  name: string;
  languageCodes: string[];
  gender: 'MALE' | 'FEMALE' | 'NEUTRAL';
  sampleRateHertz: number;
}

interface PartLike {
  id: string;
  scriptText: string;
}

type ApiKeyService = 'google_tts';

const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.enc');
const getProjectsPath = () => path.join(app.getPath('userData'), 'projects');

async function readApiKey(service: ApiKeyService): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    const secretsPath = getSecretsPath();
    const encryptedData = await fs.readFile(secretsPath);
    const decrypted = safeStorage.decryptString(encryptedData);
    const secrets = JSON.parse(decrypted);
    return secrets[service] || null;
  } catch {
    return null;
  }
}

async function getProjectPath(projectId: string): Promise<string> {
  const projectsDir = getProjectsPath();
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('.newsproj')) continue;

    const projectPath = path.join(projectsDir, entry.name);
    const metaPath = path.join(projectPath, 'project.json');

    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent);
      if (meta.id === projectId) {
        return projectPath;
      }
    } catch {
      // 読み込み失敗時はスキップ
    }
  }

  throw new Error(`Project not found: ${projectId}`);
}

function estimateDurationSec(text: string, speakingRate: number): number {
  const normalized = text.replace(/\s+/g, '').replace(/[、。．・，,.!?！？]/g, '');
  const chars = normalized.length;
  const rate = Number.isFinite(speakingRate) && speakingRate > 0 ? speakingRate : 1;
  const charsPerSec = 12 * rate;
  return Math.max(1, Math.round(chars / charsPerSec));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

let cachedGcloudAccessToken: { token: string; fetchedAtMs: number } | null = null;

async function getGcloudAccessToken(): Promise<string | null> {
  try {
    const nowMs = Date.now();
    if (cachedGcloudAccessToken && nowMs - cachedGcloudAccessToken.fetchedAtMs < 5 * 60 * 1000) {
      return cachedGcloudAccessToken.token;
    }

    const { stdout } = await execFileAsync('gcloud', [
      'auth',
      'application-default',
      'print-access-token',
    ]);
    const token = stdout.trim();
    if (token) cachedGcloudAccessToken = { token, fetchedAtMs: nowMs };
    return token ? token : null;
  } catch {
    return null;
  }
}

async function synthesizeGoogleTts(
  text: string,
  options: TTSOptions,
  projectPath: string
): Promise<AudioAsset> {
  const apiKey = await readApiKey('google_tts');
  if (!apiKey) {
    throw new Error('Google TTS APIキーが設定されていません。設定画面からAPIキーを入力してください。');
  }

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
  const requestBody: Record<string, unknown> = {
    input: { text },
    voice: {
      languageCode: options.languageCode,
      ...(options.voiceName ? { name: options.voiceName } : {}),
    },
    audioConfig: {
      audioEncoding: options.audioEncoding,
      speakingRate: clamp(options.speakingRate, 0.25, 4.0),
      pitch: clamp(options.pitch, -20, 20),
    },
  };

  const response = await withRetry(async () => {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  });

  const data = (await response.json().catch(() => ({}))) as {
    audioContent?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Google TTS APIエラー: ${response.status} ${response.statusText}`
    );
  }

  if (!data.audioContent) {
    throw new Error('Google TTSの応答に audioContent が含まれていません');
  }

  const now = new Date().toISOString();
  const audioId = randomUUID();
  const audioDir = path.join(projectPath, 'audio');
  await fs.mkdir(audioDir, { recursive: true });

  const ext = options.audioEncoding === 'MP3' ? 'mp3' : 'wav';
  const filePath = path.join(audioDir, `${audioId}.${ext}`);
  const buffer = Buffer.from(data.audioContent, 'base64');
  await fs.writeFile(filePath, buffer);
  await fs.stat(filePath);

  return {
    id: audioId,
    filePath,
    durationSec: estimateDurationSec(text, options.speakingRate),
    ttsEngine: 'google_tts',
    voiceId: options.voiceName || options.languageCode,
    settings: {
      speakingRate: options.speakingRate,
      pitch: options.pitch,
      languageCode: options.languageCode,
    },
    generatedAt: now,
  };
}

const GEMINI_TTS_MODEL_ID = 'gemini-2.5-pro-tts';
const DEFAULT_GEMINI_TTS_PROMPT =
  'あなたはプロのナレーターです。以下の文章を自然な日本語で、落ち着いたニュース調で読み上げてください。';

async function synthesizeGeminiTts(
  text: string,
  options: TTSOptions,
  projectPath: string
): Promise<AudioAsset> {
  const apiKey = await readApiKey('google_tts');
  const accessToken = await getGcloudAccessToken();

  if (!apiKey && !accessToken) {
    throw new Error(
      'Gemini-TTS を使うには、Google TTS APIキー（設定画面）または gcloud の認証（application-default）が必要です。'
    );
  }

  const url =
    accessToken || !apiKey
      ? 'https://texttospeech.googleapis.com/v1/text:synthesize'
      : `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
    const quotaProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    if (quotaProjectId) headers['x-goog-user-project'] = quotaProjectId;
  }

  const requestBody: Record<string, unknown> = {
    input: {
      prompt: DEFAULT_GEMINI_TTS_PROMPT,
      text,
    },
    voice: {
      languageCode: options.languageCode,
      ...(options.voiceName ? { name: options.voiceName } : {}),
      modelName: GEMINI_TTS_MODEL_ID,
    },
    audioConfig: {
      audioEncoding: options.audioEncoding,
      speakingRate: clamp(options.speakingRate, 0.25, 4.0),
      pitch: clamp(options.pitch, -20, 20),
    },
  };

  const response = await withRetry(async () => {
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  });

  const data = (await response.json().catch(() => ({}))) as {
    audioContent?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? '（Gemini-TTS は Cloud 側の権限/課金設定が必要な場合があります。gcloud 認証 + 環境変数 GOOGLE_CLOUD_PROJECT の設定も試してください）'
        : '';
    throw new Error(
      `${data.error?.message || `Gemini-TTS APIエラー: ${response.status} ${response.statusText}`}${hint}`
    );
  }

  if (!data.audioContent) {
    throw new Error('Gemini-TTSの応答に audioContent が含まれていません');
  }

  const now = new Date().toISOString();
  const audioId = randomUUID();
  const audioDir = path.join(projectPath, 'audio');
  await fs.mkdir(audioDir, { recursive: true });

  const ext = options.audioEncoding === 'MP3' ? 'mp3' : 'wav';
  const filePath = path.join(audioDir, `${audioId}.${ext}`);
  const buffer = Buffer.from(data.audioContent, 'base64');
  await fs.writeFile(filePath, buffer);
  await fs.stat(filePath);

  return {
    id: audioId,
    filePath,
    durationSec: estimateDurationSec(text, options.speakingRate),
    ttsEngine: 'gemini_tts',
    voiceId: options.voiceName || options.languageCode,
    settings: {
      speakingRate: options.speakingRate,
      pitch: options.pitch,
      languageCode: options.languageCode,
    },
    generatedAt: now,
  };
}

async function synthesizeMacosTts(
  text: string,
  options: TTSOptions,
  projectPath: string
): Promise<AudioAsset> {
  const now = new Date().toISOString();
  const audioId = randomUUID();
  const audioDir = path.join(projectPath, 'audio');
  await fs.mkdir(audioDir, { recursive: true });

  const tmpAiffPath = path.join(audioDir, `${audioId}.aiff`);
  const wavPath = path.join(audioDir, `${audioId}.wav`);

  const wpm = Math.round(200 * clamp(options.speakingRate, 0.5, 2.0));
  const sayArgs: string[] = [];
  if (options.voiceName) {
    sayArgs.push('-v', options.voiceName);
  }
  sayArgs.push('-r', String(wpm));
  sayArgs.push('-o', tmpAiffPath);
  sayArgs.push(text);

  await execFileAsync('say', sayArgs);
  await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', tmpAiffPath, wavPath]);
  await fs.unlink(tmpAiffPath).catch(() => {});

  await fs.stat(wavPath);

  return {
    id: audioId,
    filePath: wavPath,
    durationSec: estimateDurationSec(text, options.speakingRate),
    ttsEngine: 'macos_tts',
    voiceId: options.voiceName || 'default',
    settings: {
      speakingRate: options.speakingRate,
      pitch: options.pitch,
      languageCode: options.languageCode,
    },
    generatedAt: now,
  };
}

async function listGoogleVoices(): Promise<VoiceInfo[]> {
  const apiKey = await readApiKey('google_tts');
  if (!apiKey) return [];

  const url = `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`;
  const response = await fetch(url);
  const data = (await response.json().catch(() => ({}))) as {
    voices?: Array<{
      name: string;
      languageCodes: string[];
      ssmlGender?: 'MALE' | 'FEMALE' | 'NEUTRAL' | 'SSML_VOICE_GENDER_UNSPECIFIED';
      naturalSampleRateHertz?: number;
    }>;
  };

  if (!response.ok) return [];
  if (!data.voices) return [];

  return data.voices.map((v) => ({
    name: v.name,
    languageCodes: v.languageCodes,
    gender:
      v.ssmlGender === 'MALE' || v.ssmlGender === 'FEMALE' || v.ssmlGender === 'NEUTRAL'
        ? v.ssmlGender
        : 'NEUTRAL',
    sampleRateHertz: v.naturalSampleRateHertz || 24000,
  }));
}

async function listMacosVoices(): Promise<VoiceInfo[]> {
  const { stdout } = await execFileAsync('say', ['-v', '?']);
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);

  const voices: VoiceInfo[] = [];

  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(\S+)\s+#/);
    if (!match) continue;
    const name = match[1];
    const locale = match[2].replace('_', '-');
    voices.push({
      name,
      languageCodes: [locale],
      gender: 'NEUTRAL',
      sampleRateHertz: 22050,
    });
  }

  return voices;
}

async function listGeminiVoices(): Promise<VoiceInfo[]> {
  const names = [
    'Kore',
    'Puck',
    'Zephyr',
    'Charon',
    'Fenrir',
    'Leda',
    'Orus',
    'Aoede',
    'Callirrhoe',
    'Eros',
    'Iapetus',
    'Laomedeia',
    'Phoebe',
  ];

  return names.map((name) => ({
    name,
    languageCodes: ['ja-JP'],
    gender: 'NEUTRAL',
    sampleRateHertz: 24000,
  }));
}

ipcMain.handle(
  'tts:getVoices',
  async (_, engine?: TTSEngine): Promise<VoiceInfo[]> => {
    if (engine === 'macos_tts') return listMacosVoices();
    if (engine === 'gemini_tts') return listGeminiVoices();
    if (engine === 'google_tts') return listGoogleVoices();
    // デフォルトはGoogle（キーが無ければmacOS）
    const google = await listGoogleVoices();
    if (google.length > 0) return google;
    return listMacosVoices();
  }
);

ipcMain.handle(
  'tts:generate',
  async (
    _,
    text: string,
    options: TTSOptions,
    projectId: string
  ): Promise<AudioAsset> => {
    if (!projectId) throw new Error('projectId が指定されていません');
    const projectPath = await getProjectPath(projectId);

    if (options.ttsEngine === 'macos_tts') {
      return synthesizeMacosTts(text, options, projectPath);
    }
    if (options.ttsEngine === 'gemini_tts') {
      return synthesizeGeminiTts(text, options, projectPath);
    }
    return synthesizeGoogleTts(text, options, projectPath);
  }
);

ipcMain.handle(
  'tts:generateBatch',
  async (
    _,
    parts: PartLike[],
    options: TTSOptions,
    projectId: string
  ): Promise<AudioAsset[]> => {
    if (!projectId) throw new Error('projectId が指定されていません');
    const projectPath = await getProjectPath(projectId);

    const targets = parts
      .map((part) => ({ part, text: part.scriptText || '' }))
      .filter((item) => item.text.trim().length > 0)
      .map((item, index) => ({ ...item, index }));

    const out: Array<AudioAsset | null> = Array(targets.length).fill(null);
    const errors: { index: number; error: string }[] = [];

    await Promise.all(
      targets.map(async (item) => {
        try {
          const audio =
            options.ttsEngine === 'macos_tts'
              ? await synthesizeMacosTts(item.text, options, projectPath)
              : options.ttsEngine === 'gemini_tts'
                ? await synthesizeGeminiTts(item.text, options, projectPath)
                : await synthesizeGoogleTts(item.text, options, projectPath);
          out[item.index] = audio;
        } catch (error) {
          errors.push({
            index: item.index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );

    const results = out.filter((value): value is AudioAsset => !!value);

    if (errors.length > 0 && results.length === 0) {
      throw new Error(`全ての音声生成に失敗しました: ${errors.map((e) => e.error).join(', ')}`);
    }

    return results;
  }
);
