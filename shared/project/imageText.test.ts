import { describe, expect, it } from 'vitest';
import {
  IMAGE_TEXT_RULE,
  IMAGE_TEXT_RULE_WITHOUT_SECTION,
  IMAGE_TEXT_SECTION_LABEL,
  formatImageTextSection,
  getImageTextRule,
  hasImageTextSection,
  upgradeLegacyImageTextSection,
} from './imageText';

describe('getImageTextRule', () => {
  it('uses the strict rule only when the prompt has the text section', () => {
    const withSection = ['画面に描く文字:', '- 見出し:「新しい橋」'].join('\n');
    expect(hasImageTextSection(withSection)).toBe(true);
    expect(getImageTextRule(withSection)).toBe(IMAGE_TEXT_RULE);
  });

  it('keeps text drawable for legacy fallback and free-form prompts', () => {
    const legacyFallback = [
      'スライド仕様',
      '主題: 橋の開通',
      'テキスト: 見出し・ラベル・数値のみ',
    ].join('\n');
    expect(hasImageTextSection(legacyFallback)).toBe(false);
    expect(getImageTextRule(legacyFallback)).toBe(IMAGE_TEXT_RULE_WITHOUT_SECTION);
    expect(getImageTextRule('見出し「新しい橋」を大きく描く')).toBe(
      IMAGE_TEXT_RULE_WITHOUT_SECTION
    );
    expect(IMAGE_TEXT_RULE_WITHOUT_SECTION).not.toContain('この文字列以外は描かない');
  });
});

describe('IMAGE_TEXT_RULE', () => {
  it('refers to the quoted text section and says "no other text" once', () => {
    expect(IMAGE_TEXT_RULE).toContain(`「${IMAGE_TEXT_SECTION_LABEL}」欄`);
    expect(IMAGE_TEXT_RULE.split('この文字列以外は描かない')).toHaveLength(2);
  });
});

describe('formatImageTextSection', () => {
  it('lists each string in 「」 and skips empty items', () => {
    expect(
      formatImageTextSection([
        { label: '見出し', text: '新しい橋が開通' },
        { label: 'サブ見出し', text: '  ' },
        { label: 'キー数値', text: undefined },
        { label: '要点1', text: '「通勤時間が短縮」' },
      ])
    ).toEqual(['画面に描く文字:', '- 見出し:「新しい橋が開通」', '- 要点1:「通勤時間が短縮」']);
  });

  it('keeps inner brackets that are part of the text', () => {
    expect(formatImageTextSection([{ label: '見出し', text: '「円安」が加速' }])).toEqual([
      '画面に描く文字:',
      '- 見出し:「「円安」が加速」',
    ]);
  });

  it('returns no lines when there is nothing to draw', () => {
    expect(formatImageTextSection([{ label: '見出し', text: '' }])).toEqual([]);
  });
});

describe('upgradeLegacyImageTextSection', () => {
  it('rewrites the legacy 画面コピー section into the quoted format', () => {
    const legacy = [
      'リッチニューススライド仕様',
      '画面コピー:',
      '- 見出し: 新しい橋が開通',
      '- キー数値: 25%',
      'オブジェクト配置:',
      '- 1: headline / top-center / large / 主情報 / 見出し',
    ].join('\n');

    expect(upgradeLegacyImageTextSection(legacy)).toBe(
      [
        'リッチニューススライド仕様',
        '画面に描く文字:',
        '- 見出し:「新しい橋が開通」',
        '- キー数値:「25%」',
        'オブジェクト配置:',
        '- 1: headline / top-center / large / 主情報 / 見出し',
      ].join('\n')
    );
  });

  it('drops empty entries of the old 画面テキスト section', () => {
    const legacy = ['画面テキスト:', '- 1: 原油先物', '- 2: +5%', '- 3:', '- 4:', '禁止:'].join(
      '\n'
    );

    expect(upgradeLegacyImageTextSection(legacy)).toBe(
      ['画面に描く文字:', '- 1:「原油先物」', '- 2:「+5%」', '禁止:'].join('\n')
    );
  });

  it('leaves new-format and free-form prompts unchanged', () => {
    const current = ['画面に描く文字:', '- 見出し:「新しい橋」'].join('\n');
    expect(upgradeLegacyImageTextSection(current)).toBe(current);
    expect(upgradeLegacyImageTextSection('橋の図解')).toBe('橋の図解');
  });
});
