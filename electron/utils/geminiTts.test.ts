import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import { measurePcmWav } from '../../shared/project/audioQuality';
import { buildGeminiTtsRequest, decodeGeminiTtsAudio, pcm16leToWavBuffer } from './geminiTts';

const STYLE = '情報番組のナレーションとして、落ち着いたニュース調で読み上げてください。';
const TEXT = '本日の主なニュースをお伝えします。';

function countAscii(buffer: Buffer, needle: string): number {
  let count = 0;
  for (let index = buffer.indexOf(needle); index !== -1; index = buffer.indexOf(needle, index + 1))
    count++;
  return count;
}

describe('buildGeminiTtsRequest', () => {
  it('sends only the transcript in contents and the style via speechMetadata for 3.8 models', () => {
    for (const model of ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'] as const) {
      const request = buildGeminiTtsRequest({ model, text: TEXT, style: STYLE, voiceName: 'Kore' });

      expect(request.model).toBe(model);
      expect(request.contents).toEqual([{ role: 'user', parts: [{ text: TEXT }] }]);
      expect(JSON.stringify(request.contents)).not.toContain(STYLE);
      expect(request.config).toMatchObject({
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        httpOptions: {
          extraBody: {
            contents: [{ role: 'user', parts: [{ text: TEXT, speechMetadata: { style: STYLE } }] }],
          },
        },
      });
    }
  });

  it('omits speechMetadata when the 3.8 style is empty', () => {
    const request = buildGeminiTtsRequest({
      model: 'gemini-3.8-flash-tts',
      text: TEXT,
      style: '  ',
      voiceName: 'Kore',
    });
    expect(request.contents).toEqual([{ role: 'user', parts: [{ text: TEXT }] }]);
    expect(request.config).not.toHaveProperty('httpOptions');
  });

  it('keeps prefixing the instruction for 3.1 / 2.5 models', () => {
    for (const model of [
      'gemini-3.1-flash-tts-preview',
      'gemini-2.5-pro-preview-tts',
      'gemini-2.5-flash-preview-tts',
    ] as const) {
      const request = buildGeminiTtsRequest({
        model,
        text: TEXT,
        style: STYLE,
        voiceName: 'Charon',
      });
      expect(request).toEqual({
        model,
        contents: `${STYLE}\n\n${TEXT}`,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
        },
      });
    }
  });
});

describe('@google/genai 1.x wire format (fetch stubbed, no network)', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function captureRequestBody(model: Parameters<typeof buildGeminiTtsRequest>[0]['model']) {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: 'AAAA' } }] } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    const ai = new GoogleGenAI({ apiKey: 'test-key' });
    await ai.models.generateContent(
      buildGeminiTtsRequest({ model, text: TEXT, style: STYLE, voiceName: 'Kore' })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { url: String(url), body: JSON.parse(String(init.body)) };
  }

  it('puts speechMetadata.style on the part and keeps the transcript verbatim for 3.8', async () => {
    const { url, body } = await captureRequestBody('gemini-3.8-flash-tts');

    expect(url).toContain('models/gemini-3.8-flash-tts:generateContent');
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: TEXT, speechMetadata: { style: STYLE } }] },
    ]);
    expect(body.generationConfig).toEqual({
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    });
    expect(body).not.toHaveProperty('httpOptions');
  });

  it('sends the prefixed prompt unchanged for 3.1', async () => {
    const { body } = await captureRequestBody('gemini-3.1-flash-tts-preview');

    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: `${STYLE}\n\n${TEXT}` }] }]);
    expect(JSON.stringify(body)).not.toContain('speechMetadata');
  });
});

describe('decodeGeminiTtsAudio', () => {
  it('saves RIFF WAV responses as-is and measures duration from the header', () => {
    // 16kHz / mono / 16bit / 0.5 秒: ヘッダを読まずに 24kHz 前提で計算すると 0.33 秒になる
    const wav = pcm16leToWavBuffer(Buffer.alloc(16_000), 16_000, 1);

    const decoded = decodeGeminiTtsAudio(wav);

    expect(decoded.sourceFormat).toBe('wav');
    expect(decoded.wav.equals(wav)).toBe(true);
    expect(countAscii(decoded.wav, 'RIFF')).toBe(1);
    expect(decoded.durationSec).toBe(0.5);
  });

  it('adds a single 24kHz mono header to headerless PCM responses', () => {
    const pcm = Buffer.alloc(24_000 * 2 * 3); // 3 秒

    const decoded = decodeGeminiTtsAudio(pcm);

    expect(decoded.sourceFormat).toBe('pcm');
    expect(decoded.wav.length).toBe(44 + pcm.length);
    expect(decoded.wav.subarray(44).equals(pcm)).toBe(true);
    expect(countAscii(decoded.wav, 'RIFF')).toBe(1);
    expect(decoded.durationSec).toBe(3);
    expect(measurePcmWav(decoded.wav)).toMatchObject({
      durationSec: 3,
      sampleRate: 24_000,
      channels: 1,
    });
  });

  it('rejects a broken RIFF response instead of saving it', () => {
    const truncated = pcm16leToWavBuffer(Buffer.alloc(4_800), 24_000, 1).subarray(0, 100);

    expect(() => decodeGeminiTtsAudio(truncated)).toThrow('Gemini TTSの応答音声（WAV）を解析');
  });
});
