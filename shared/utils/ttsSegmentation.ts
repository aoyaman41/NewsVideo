export function splitScriptIntoSegments(text: string): string[] {
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

export function parseMarkIndex(markName: string): number | null {
  const match = markName.match(/^m(\d+)$/);
  if (!match) return null;
  const idx = Number(match[1]);
  return Number.isFinite(idx) ? idx : null;
}
