import type { GenerateContentParameters } from '@google/genai';
import { getGeminiTtsModelCapabilities, type GeminiTtsModel } from '../../shared/constants/models';
import { measurePcmWav } from '../../shared/project/audioQuality';

/** ヘッダなし PCM で返るモデル(3.1 以前)の音声形式: 24kHz / mono / 16bit LE。 */
const GEMINI_TTS_PCM_SAMPLE_RATE_HERTZ = 24_000;
const GEMINI_TTS_PCM_CHANNELS = 1;

/**
 * 本文中の `<...>` を声の演出タグとして解釈するモデル(3.8 系)向けに、半角の `<` `>` を全角に変換する。
 * 台本中の不等号や山括弧がタグとして誤解釈されるのを防ぐ。
 */
export function escapeTtsAngleBrackets(text: string): string {
  return text.replace(/</g, '＜').replace(/>/g, '＞');
}

export function buildGeminiTtsRequest(params: {
  model: GeminiTtsModel;
  text: string;
  style: string;
  voiceName: string;
}): GenerateContentParameters {
  const { model, style, voiceName } = params;
  const capabilities = getGeminiTtsModelCapabilities(model);
  const text = capabilities.angleBracketTags ? escapeTtsAngleBrackets(params.text) : params.text;
  const speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName } } };

  if (!capabilities.styleViaSpeechMetadata) {
    return {
      model,
      contents: `${style}\n\n${text}`,
      config: { responseModalities: ['AUDIO'], speechConfig },
    };
  }

  // 3.8 系は入力テキストを一字一句読み上げるため、contents には本文だけを入れ、
  // 話し方の指示は GenerateContent API の part.speechMetadata.style で渡す。
  // @google/genai 1.x の Part 型と送信用変換は speechMetadata を持たず黙って落とすため、
  // SDK 公式の httpOptions.extraBody で contents を「同じ本文 + speechMetadata」に差し替える
  // (extraBody は送信直前の JSON にディープマージされ、配列は丸ごと置き換わる)。
  // SDK を 2.x に上げたら Part.speechMetadata を直接指定し、この extraBody は削除する。
  const trimmedStyle = style.trim();
  return {
    model,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig,
      ...(trimmedStyle
        ? {
            httpOptions: {
              extraBody: {
                contents: [
                  { role: 'user', parts: [{ text, speechMetadata: { style: trimmedStyle } }] },
                ],
              },
            },
          }
        : {}),
    },
  };
}

export function pcm16leToWavBuffer(
  pcmData: Buffer,
  sampleRateHertz: number,
  channels: number
): Buffer {
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

function startsWithRiff(data: Uint8Array): boolean {
  return (
    data.length >= 4 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
  );
}

function roundDurationSec(seconds: number): number {
  return Math.max(0.1, Math.round(seconds * 100) / 100);
}

export type DecodedGeminiTtsAudio = {
  /** そのまま .wav として保存できるバイト列 */
  wav: Buffer;
  durationSec: number;
  /** 応答データの実際の形式 */
  sourceFormat: 'wav' | 'pcm';
};

/**
 * Gemini TTS の応答音声を WAV に揃える。モデル名ではなく実データの先頭で判定する。
 * - 先頭が RIFF(3.8 系の既定): WAV として解析し、ヘッダを付け直さずにそのまま使う
 * - それ以外(3.1 以前の既定): 24kHz / mono / 16bit のヘッダなし PCM とみなしてヘッダを付ける
 */
export function decodeGeminiTtsAudio(data: Buffer): DecodedGeminiTtsAudio {
  if (startsWithRiff(data)) {
    let measured: ReturnType<typeof measurePcmWav>;
    try {
      measured = measurePcmWav(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Gemini TTSの応答音声（WAV）を解析できませんでした: ${message}`);
    }
    return { wav: data, durationSec: roundDurationSec(measured.durationSec), sourceFormat: 'wav' };
  }

  const wav = pcm16leToWavBuffer(data, GEMINI_TTS_PCM_SAMPLE_RATE_HERTZ, GEMINI_TTS_PCM_CHANNELS);
  const durationSec =
    data.length / (GEMINI_TTS_PCM_SAMPLE_RATE_HERTZ * GEMINI_TTS_PCM_CHANNELS * 2);
  return { wav, durationSec: roundDurationSec(durationSec), sourceFormat: 'pcm' };
}
