import { describe, expect, it } from 'vitest';
import { sanitizeImagePromptForRendering } from './imagePromptSanitizer';

describe('sanitizeImagePromptForRendering', () => {
  it('removes layout percentages while keeping placement content', () => {
    const input = `スライド仕様:
主題: 相続トラブルと不動産
レイアウト方針: 左30%に背景要因、右70%を上下に分け不動産と現金の対比を配置
視線誘導: 左の要因一覧 → 右上の不動産（×） → 右下の現金（○）
配置:
- 左(サイズ/内容): 30% / 「遺言」「贈与」などの積み木状ブロック図
- 中央(サイズ/内容): 0% / 未使用
- 右上(サイズ/内容): 45% / 家のイラストに分割線と「×」印
- 右下(サイズ/内容): 25% / 札束のイラストがきれいに等分される図
画面テキスト:
- 1: 不動産
- 2: 分割困難`;

    const output = sanitizeImagePromptForRendering(input);

    expect(output).not.toContain('30%');
    expect(output).not.toContain('70%');
    expect(output).not.toContain('45%');
    expect(output).not.toContain('25%');
    expect(output).toContain('レイアウト方針: 左に背景要因、右を上下に分け不動産と現金の対比を配置');
    expect(output).toContain('- 左: 「遺言」「贈与」などの積み木状ブロック図');
    expect(output).toContain('- 右上: 家のイラストに分割線と「×」印');
  });

  it('keeps percentage values inside screen text', () => {
    const input = `スライド仕様:
配置:
- 左(サイズ感/内容): 大 / 棒グラフ
画面テキスト:
- 1: 前日比
- 2: +5%`;

    const output = sanitizeImagePromptForRendering(input);

    expect(output).toContain('- 2: +5%');
    expect(output).not.toContain('大 /');
  });
});
