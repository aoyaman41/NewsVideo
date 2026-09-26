/**
 * 画像データのヘッダから実際の幅・高さを読む(PNG / JPEG / WebP)。
 * 読めない形式や壊れたデータでは null を返し、呼び出し側で要求値にフォールバックする。
 */
export function readImageDimensions(data: Uint8Array): { width: number; height: number } | null {
  return readPngDimensions(data) ?? readJpegDimensions(data) ?? readWebpDimensions(data);
}

function valid(width: number, height: number): { width: number; height: number } | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function readPngDimensions(data: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || signature.some((byte, index) => data[index] !== byte)) return null;
  // 先頭チャンクは IHDR(8 バイトの署名 + 長さ 4 + 種別 4 の後に幅・高さ)
  if (String.fromCharCode(data[12], data[13], data[14], data[15]) !== 'IHDR') return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return valid(view.getUint32(16), view.getUint32(20));
}

function readJpegDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1];
    // 詰め物の 0xFF と、長さを持たないマーカーを飛ばす
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > data.length) return null;
      return valid(view.getUint16(offset + 7), view.getUint16(offset + 5));
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 30) return null;
  const tag = (start: number) =>
    String.fromCharCode(data[start], data[start + 1], data[start + 2], data[start + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  const chunk = tag(12);
  if (chunk === 'VP8X') {
    const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
    const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
    return valid(width, height);
  }
  if (chunk === 'VP8 ') {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return null;
}
