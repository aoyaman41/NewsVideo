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

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  model?: string;
};

interface AudioAsset {
  id: string;
  filePath: string;
  durationSec: number;
  ttsEngine: TTSEngine;
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

type ApiKeyService = 'google_tts' | 'google_ai';

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

function pcm16leToWavBuffer(pcmData: Buffer, sampleRateHertz: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRateHertz * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHertz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

function escapeSsmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function splitScriptIntoSegments(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const segments: string[] = [];
  let buffer = '';

  const flush = () => {
    const seg = buffer.replace(/\n+/g, ' ').trim();
    buffer = '';
    if (seg) segments.push(seg);
  };

  for (const ch of normalized) {
    buffer += ch;
    if (ch === '\n') {
      flush();
      continue;
    }
    if ('。！？!?'.includes(ch)) {
      flush();
      continue;
    }
    if (ch === '、' && buffer.length >= 40) {
      flush();
      continue;
    }
    if (buffer.length >= 80) {
      flush();
    }
  }
  flush();

  return segments;
}

function buildSsmlWithMarks(segments: string[]): string {
  const body = segments
    .map((seg, i) => `<mark name="m${i}"/>${escapeSsmlText(seg)}`)
    .join('');
  return `<speak>${body}</speak>`;
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

  const segments = splitScriptIntoSegments(text);
  const enableSync = segments.length >= 2 && segments.length <= 200;
  const url = `https://texttospeech.googleapis.com/${
    enableSync ? 'v1beta1' : 'v1'
  }/text:synthesize?key=${apiKey}`;
  const requestBody: Record<string, unknown> = {
    input: enableSync ? { ssml: buildSsmlWithMarks(segments) } : { text },
    voice: {
      languageCode: options.languageCode,
      ...(options.voiceName ? { name: options.voiceName } : {}),
    },
    audioConfig: {
      audioEncoding: options.audioEncoding,
      speakingRate: clamp(options.speakingRate, 0.25, 4.0),
      pitch: clamp(options.pitch, -20, 20),
    },
    ...(enableSync ? { enableTimePointing: ['SSML_MARK'] } : {}),
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
    timepoints?: Array<{ markName?: string; timeSeconds?: number }>;
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

  const timepoints = enableSync
    ? (Array.isArray(data.timepoints) ? data.timepoints : [])
        .map((tp) => ({
          markName: String(tp.markName || ''),
          timeSeconds: Number(tp.timeSeconds),
        }))
        .filter((tp) => tp.markName && Number.isFinite(tp.timeSeconds) && tp.timeSeconds >= 0)
        .sort((a, b) => a.timeSeconds - b.timeSeconds)
    : [];

  return {
    id: audioId,
    filePath,
    durationSec: estimateDurationSec(text, options.speakingRate),
    ttsEngine: 'google_tts',
    voiceId: options.voiceName || options.languageCode,
    segments: enableSync ? segments : undefined,
    timepoints: timepoints.length > 0 ? timepoints : undefined,
    settings: {
      speakingRate: options.speakingRate,
      pitch: options.pitch,
      languageCode: options.languageCode,
    },
    generatedAt: now,
  };
}

const GEMINI_TTS_MODEL_ID = 'gemini-2.5-pro-preview-tts';
const DEFAULT_GEMINI_TTS_PROMPT =
  'ニュース番組のナレーションとして、次の文章を自然な日本語で、落ち着いたニュース調で読み上げてください。';

async function synthesizeGeminiTts(
  text: string,
  options: TTSOptions,
  projectPath: string
): Promise<{ audio: AudioAsset; usage: TokenUsage | null }> {
  const apiKey = await readApiKey('google_ai');
  if (!apiKey) {
    throw new Error(
      'Google AI APIキーが設定されていません。設定画面から（Google AI Studio / Generative Language）用のAPIキーを入力してください。'
    );
  }

  const voiceName = options.voiceName || 'Charon';
  const promptText = text.trim();
  if (!promptText) {
    throw new Error('読み上げテキストが空です');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL_ID}:generateContent`;
  const requestBody: Record<string, unknown> = {
    model: GEMINI_TTS_MODEL_ID,
    contents: [
      {
        role: 'user',
        parts: [{ text: `${DEFAULT_GEMINI_TTS_PROMPT}\n\n${promptText}` }],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  const response = await withRetry(async () => {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
    });
  });

  const data = (await response.json().catch(() => ({}))) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          text?: string;
        }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Gemini TTS APIエラー: ${response.status} ${response.statusText}`
    );
  }

  const parts = data.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find((p) => p.inlineData?.data);
  const base64 = audioPart?.inlineData?.data;
  if (!base64) {
    throw new Error('Gemini TTSの応答に音声データが含まれていません');
  }

  const pcmData = Buffer.from(base64, 'base64');
  const sampleRateHertz = 24000;
  const channels = 1;
  const wav = pcm16leToWavBuffer(pcmData, sampleRateHertz, channels);

  const now = new Date().toISOString();
  const audioId = randomUUID();
  const audioDir = path.join(projectPath, 'audio');
  await fs.mkdir(audioDir, { recursive: true });

  const filePath = path.join(audioDir, `${audioId}.wav`);
  await fs.writeFile(filePath, wav);
  await fs.stat(filePath);

  const durationSecRaw = pcmData.length / (sampleRateHertz * channels * 2);
  const durationSec = Math.max(0.1, Math.round(durationSecRaw * 100) / 100);
  const segments = splitScriptIntoSegments(text);
  const audio: AudioAsset = {
    id: audioId,
    filePath,
    durationSec,
    ttsEngine: 'gemini_tts',
    voiceId: voiceName,
    segments: segments.length > 0 ? segments : undefined,
    settings: {
      speakingRate: options.speakingRate,
      pitch: options.pitch,
      languageCode: options.languageCode,
    },
    generatedAt: now,
  };
  const usage = data.usageMetadata
    ? {
        inputTokens: data.usageMetadata.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata.totalTokenCount,
        model: GEMINI_TTS_MODEL_ID,
      }
    : null;

  return { audio, usage };
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
    'Zephyr',
    'Puck',
    'Charon',
    'Kore',
    'Fenrir',
    'Leda',
    'Orus',
    'Aoede',
    'Callirrhoe',
    'Autonoe',
    'Enceladus',
    'Iapetus',
    'Umbriel',
    'Algieba',
    'Despina',
    'Erinome',
    'Algenib',
    'Rasalgethi',
    'Laomedeia',
    'Achernar',
    'Alnilam',
    'Schedar',
    'Gacrux',
    'Pulcherrima',
    'Achird',
    'Zubenelgenubi',
    'Vindemiatrix',
    'Sadachbia',
    'Sadaltager',
    'Sulafat',
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
  ): Promise<{ audio: AudioAsset; usage: TokenUsage | null }> => {
    if (!projectId) throw new Error('projectId が指定されていません');
    const projectPath = await getProjectPath(projectId);

    if (options.ttsEngine === 'macos_tts') {
      const audio = await synthesizeMacosTts(text, options, projectPath);
      return { audio, usage: null };
    }
    if (options.ttsEngine === 'gemini_tts') {
      return synthesizeGeminiTts(text, options, projectPath);
    }
    const audio = await synthesizeGoogleTts(text, options, projectPath);
    return { audio, usage: null };
  }
);

ipcMain.handle(
  'tts:generateBatch',
  async (
    _,
    parts: PartLike[],
    options: TTSOptions,
    projectId: string
  ): Promise<Array<{ audio: AudioAsset; usage: TokenUsage | null }>> => {
    if (!projectId) throw new Error('projectId が指定されていません');
    const projectPath = await getProjectPath(projectId);

    const targets = parts
      .map((part) => ({ part, text: part.scriptText || '' }))
      .filter((item) => item.text.trim().length > 0)
      .map((item, index) => ({ ...item, index }));

    const out: Array<{ audio: AudioAsset; usage: TokenUsage | null } | null> =
      Array(targets.length).fill(null);
    const errors: { index: number; error: string }[] = [];

    await Promise.all(
      targets.map(async (item) => {
        try {
          const result =
            options.ttsEngine === 'macos_tts'
              ? { audio: await synthesizeMacosTts(item.text, options, projectPath), usage: null }
              : options.ttsEngine === 'gemini_tts'
                ? await synthesizeGeminiTts(item.text, options, projectPath)
                : { audio: await synthesizeGoogleTts(item.text, options, projectPath), usage: null };
          out[item.index] = result;
        } catch (error) {
          errors.push({
            index: item.index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );

    const results = out.filter(
      (value): value is { audio: AudioAsset; usage: TokenUsage | null } => !!value
    );

    if (errors.length > 0 && results.length === 0) {
      throw new Error(`全ての音声生成に失敗しました: ${errors.map((e) => e.error).join(', ')}`);
    }

    return results;
  }
);
