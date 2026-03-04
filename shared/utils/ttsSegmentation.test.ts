import { describe, expect, it } from 'vitest';
import { parseMarkIndex, splitScriptIntoSegments } from './ttsSegmentation';

describe('splitScriptIntoSegments', () => {
  it('splits by punctuation and line breaks', () => {
    const input = '1行目です。\n2行目です！3行目?';
    expect(splitScriptIntoSegments(input)).toEqual(['1行目です。', '2行目です！', '3行目?']);
  });

  it('normalizes repeated line breaks inside segments', () => {
    const input = '先頭\n\n中間\n末尾';
    expect(splitScriptIntoSegments(input)).toEqual(['先頭', '中間', '末尾']);
  });

  it('splits long text around 80 chars when no punctuation exists', () => {
    const input = 'あ'.repeat(90);
    const segments = splitScriptIntoSegments(input);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].length).toBeGreaterThanOrEqual(80);
  });
});

describe('parseMarkIndex', () => {
  it('parses valid mark names', () => {
    expect(parseMarkIndex('m0')).toBe(0);
    expect(parseMarkIndex('m12')).toBe(12);
  });

  it('returns null for invalid mark names', () => {
    expect(parseMarkIndex('mark-1')).toBeNull();
    expect(parseMarkIndex('m')).toBeNull();
  });
});
