export type AudioMeasurement = { durationSec: number; peakDbfs: number; rmsDbfs: number; silenceRatio: number; clippedSamples: number; sampleRate: number; channels: number };
export function measurePcmWav(bytes: Uint8Array): AudioMeasurement {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('PCM WAV形式の音声が必要です。');
  let format = 0, channels = 0, sampleRate = 0, bits = 0, start = 0, length = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) throw new Error('音声データが途中で切れています。');
    if (tag(offset) === 'fmt ' && size >= 16) { format = view.getUint16(offset + 8, true); channels = view.getUint16(offset + 10, true); sampleRate = view.getUint32(offset + 12, true); bits = view.getUint16(offset + 22, true); }
    if (tag(offset) === 'data') { start = offset + 8; length = size; }
    offset += 8 + size + (size % 2);
  }
  if (format !== 1 || bits !== 16 || !channels || !sampleRate || !length) throw new Error('16ビットPCM WAVの実測に対応しています。');
  let peak = 0, squares = 0, silence = 0, clipped = 0;
  const count = Math.floor(length / 2);
  for (let index = 0; index < count; index++) { const value = Math.abs(view.getInt16(start + index * 2, true)) / 32768; peak = Math.max(peak, value); squares += value * value; if (value < 0.003162) silence++; if (value >= 0.999) clipped++; }
  return { durationSec: count / channels / sampleRate, peakDbfs: 20 * Math.log10(Math.max(peak, 1e-8)), rmsDbfs: 20 * Math.log10(Math.max(Math.sqrt(squares / count), 1e-8)), silenceRatio: silence / count, clippedSamples: clipped, sampleRate, channels };
}
