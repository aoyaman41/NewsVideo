import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTtsNarrationInstruction } from '../../shared/project/ttsNarrationStyles';
import { normalizeSettings } from '../../shared/settings/appSettings';
import { generationSettings } from '../utils/generationContext';
import { pcm16leToWavBuffer } from '../utils/geminiTts';
import { invokeOperation } from './operations';

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/tmp/test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: () => JSON.stringify({ google_ai: 'test-google-ai' }),
  },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));
vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (file: string) =>
    file.endsWith('project.json') ? JSON.stringify({ id: 'project' }) : Buffer.from('encrypted')
  ),
  readdir: vi.fn(async () => [{ name: 'test.newsproj', isDirectory: () => true }]),
  mkdir: vi.fn(),
  writeFile: mocks.writeFile,
  stat: vi.fn(async () => ({ size: 42 })),
  unlink: vi.fn(),
}));

const TEXT = '本日の主なニュースをお伝えします。';
const INSTRUCTION = buildTtsNarrationInstruction('news', '語尾はやわらかめに');

type GenerateResult = {
  audio: { filePath: string; durationSec: number; voiceId: string };
  usage: { inputTokens: number; outputTokens: number; model?: string } | null;
};

function audioResponse(bytes: Buffer, mimeType: string) {
  return {
    candidates: [
      { content: { parts: [{ inlineData: { mimeType, data: bytes.toString('base64') } }] } },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 75, totalTokenCount: 87 },
  };
}

function generate(ttsModel: string): Promise<GenerateResult> {
  return generationSettings.run(normalizeSettings({}), () =>
    invokeOperation<GenerateResult>(
      'tts:generate',
      TEXT,
      {
        ttsEngine: 'gemini_tts',
        ttsModel,
        voiceName: 'Charon',
        languageCode: 'ja-JP',
        speakingRate: 1,
        pitch: 0,
        audioEncoding: 'MP3',
        narrationStylePreset: 'news',
        narrationStyleNote: '語尾はやわらかめに',
      },
      'project'
    )
  );
}

beforeAll(async () => {
  await import('./tts');
});

beforeEach(() => {
  mocks.generateContent.mockReset();
  mocks.writeFile.mockReset();
});

describe('tts:generate with Gemini TTS', () => {
  it.each(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'])(
    'sends the narration instruction as speechMetadata.style for %s and keeps the returned WAV',
    async (model) => {
      const wav = pcm16leToWavBuffer(Buffer.alloc(24_000 * 2 * 2), 24_000, 1); // 2 秒
      mocks.generateContent.mockResolvedValue(audioResponse(wav, 'audio/wav'));

      const result = await generate(model);

      const request = mocks.generateContent.mock.calls[0][0];
      expect(request.model).toBe(model);
      expect(request.contents).toEqual([{ role: 'user', parts: [{ text: TEXT }] }]);
      expect(JSON.stringify(request.contents)).not.toContain('読み上げてください');
      expect(request.config.speechConfig).toEqual({
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
      });
      expect(request.config.httpOptions.extraBody.contents).toEqual([
        { role: 'user', parts: [{ text: TEXT, speechMetadata: { style: INSTRUCTION } }] },
      ]);

      const [filePath, written] = mocks.writeFile.mock.calls[0];
      expect(filePath).toMatch(/\.wav$/);
      expect(Buffer.from(written).equals(wav)).toBe(true);
      expect(result.audio.durationSec).toBe(2);
      expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 75, model });
    }
  );

  it('keeps the prefixed instruction and PCM wrapping for Gemini 3.1 Flash TTS', async () => {
    const pcm = Buffer.alloc(24_000 * 2 * 1.5); // 1.5 秒
    mocks.generateContent.mockResolvedValue(audioResponse(pcm, 'audio/L16;codec=pcm;rate=24000'));

    const result = await generate('gemini-3.1-flash-tts-preview');

    const request = mocks.generateContent.mock.calls[0][0];
    expect(request.contents).toBe(`${INSTRUCTION}\n\n${TEXT}`);
    expect(request.config).not.toHaveProperty('httpOptions');

    const written = Buffer.from(mocks.writeFile.mock.calls[0][1]);
    expect(written.length).toBe(44 + pcm.length);
    expect(written.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(written.subarray(44).equals(pcm)).toBe(true);
    expect(result.audio.durationSec).toBe(1.5);
  });

  it('decides the audio format from the response bytes, not the model name', async () => {
    // 3.1 を選んでいても、RIFF 付きで返ってきた場合はヘッダを二重に付けない
    const wav = pcm16leToWavBuffer(Buffer.alloc(24_000 * 2), 24_000, 1);
    mocks.generateContent.mockResolvedValue(audioResponse(wav, 'audio/wav'));

    const result = await generate('gemini-3.1-flash-tts-preview');

    expect(Buffer.from(mocks.writeFile.mock.calls[0][1]).equals(wav)).toBe(true);
    expect(result.audio.durationSec).toBe(1);
  });
});
