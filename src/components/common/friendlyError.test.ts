import { describe, expect, it } from 'vitest';
import { describeError, describeFailures, rawErrorText } from './friendlyError';

describe('rawErrorText', () => {
  it('IPC の前置きと Error: を取り除く', () => {
    expect(
      rawErrorText(
        new Error("Error invoking remote method 'image:generate': Error: 画像がありません")
      )
    ).toBe('画像がありません');
  });

  it('書き出しの競合マーカーを取り除く', () => {
    expect(rawErrorText(new Error('[RENDER_CONFLICT] 内容が変更されました。'))).toBe(
      '内容が変更されました。'
    );
  });
});

describe('describeError', () => {
  it('API キー未設定は、提供元の名前つきで設定画面へ案内する', () => {
    const result = describeError(
      new Error('Anthropic APIキーが設定されていません。設定画面からAPIキーを入力してください。'),
      '台本を直せませんでした'
    );
    expect(result.title).toBe('台本を直せませんでした');
    expect(result.message).toContain('Anthropic の API キー');
    expect(result.action).toBe('openSettings');
    expect(result.details).toContain('Anthropic APIキー');
  });

  it('認証エラーは設定画面へ案内する', () => {
    expect(describeError(new Error('401 Incorrect API key provided'), 'x').action).toBe(
      'openSettings'
    );
  });

  it('レート制限はもう一度試すよう案内する', () => {
    const result = describeError(new Error('429 Too Many Requests: rate limit'), 'x');
    expect(result.action).toBe('retry');
    expect(result.message).toContain('しばらく待って');
  });

  it('AI の拒否は別のモデルを選ぶよう案内する', () => {
    const result = describeError(new Error('AIが拒否しました: cannot help'), 'x');
    expect(result.message).toContain('別のモデル');
    expect(result.action).toBe('openSettings');
  });

  it('接続拒否(ECONNREFUSED)を AI の拒否と取り違えない', () => {
    const result = describeError(new Error('connect ECONNREFUSED 127.0.0.1:443'), 'x');
    expect(result.message).toContain('通信');
  });

  it('日本語の短い文はそのまま見せ、画面の用語にそろえる', () => {
    const result = describeError(new Error('音声未生成のパートがあります: 2 導入'), 'x');
    expect(result.message).toBe('音声未生成のシーンがあります: 2 導入');
  });

  it('英語の長い例外は原文を出さず、詳しい内容に残す', () => {
    const raw = 'TypeError: Cannot read properties of undefined (reading "foo")';
    const result = describeError(new Error(raw), '画像を作れませんでした');
    expect(result.message).not.toContain('TypeError');
    expect(result.details).toContain('Cannot read properties');
  });
});

describe('describeFailures', () => {
  it('最初の失敗の原因と、失敗したシーンをまとめて示す', () => {
    const result = describeFailures('一部の画像を作れませんでした', [
      { label: 'シーン2', error: new Error('429 rate limit') },
      { label: 'シーン5', error: new Error('boom') },
    ]);
    expect(result.message).toContain('しばらく待って');
    expect(result.message).toContain('シーン2・シーン5');
    expect(result.details).toBe('シーン2: 429 rate limit\nシーン5: boom');
    expect(result.action).toBe('retry');
  });
});
