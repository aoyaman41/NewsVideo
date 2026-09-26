import { describe, expect, it } from 'vitest';
import { readImageDimensions } from './imageDimensions';

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

// SOI → APP0(長さ 16)→ SOF0(高さ・幅)の最小構成
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  const sof0 = Buffer.alloc(19);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0.writeUInt8(8, 4);
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
}

function webpVp8x(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

describe('readImageDimensions', () => {
  it('reads PNG, JPEG and WebP headers', () => {
    expect(readImageDimensions(png(5504, 3072))).toEqual({ width: 5504, height: 3072 });
    expect(readImageDimensions(jpeg(2752, 1536))).toEqual({ width: 2752, height: 1536 });
    expect(readImageDimensions(webpVp8x(2048, 2048))).toEqual({ width: 2048, height: 2048 });
  });

  it('returns null for unknown or truncated data', () => {
    expect(readImageDimensions(Buffer.from('not an image'))).toBeNull();
    expect(readImageDimensions(png(100, 100).subarray(0, 20))).toBeNull();
    expect(readImageDimensions(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
