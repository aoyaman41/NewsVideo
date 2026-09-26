import { describe, expect, it } from 'vitest';
import { renderConflictMessage } from '../../../shared/project/renderIntent';
import { classifyGenerationError } from '../../../shared/project/jobs';
import {
  cleanErrorMessage,
  errorToastContent,
  explainError,
  explainFailures,
} from './explainError';

const ipc = (message: string) =>
  new Error(`Error invoking remote method 'ai:generateScript': Error: ${message}`);

describe('cleanErrorMessage', () => {
  it('removes the IPC prefix and redacts key-like strings', () => {
    expect(cleanErrorMessage(ipc('401 invalid x-api-key sk-ant-api03-secret_value'))).toBe(
      '401 invalid x-api-key [キーを伏せました]'
    );
    expect(cleanErrorMessage('fetch https://x/models?key=AIzaSyA1234567890abcdefghij')).toBe(
      'fetch https://x/models?key=[キーを伏せました]'
    );
  });

  it('removes the render conflict marker', () => {
    expect(cleanErrorMessage(new Error('[RENDER_CONFLICT] 内容が変更されました。'))).toBe(
      '内容が変更されました。'
    );
  });
});

describe('explainError', () => {
  it('guides a missing API key to the settings with the service name', () => {
    const result = explainError(
      ipc('Anthropic APIキーが設定されていません。設定画面からAPIキーを入力してください。')
    );
    expect(result).toMatchObject({
      kind: 'api_key_missing',
      title: 'Anthropic の API キーが設定されていません',
      actions: ['openApiKeys', 'retry'],
    });
    expect(result.detail).toContain('Anthropic APIキー');
  });

  it('treats 401 and authentication kinds as an unusable key', () => {
    expect(explainError('接続失敗: 401 Unauthorized').kind).toBe('authentication');
    expect(explainError('401 Incorrect API key provided').kind).toBe('authentication');
    expect(explainError('something', { kind: 'authentication' }).actions).toContain('openApiKeys');
  });

  it('offers another model when Claude refuses', () => {
    const result = explainError(
      'Claudeが安全上の理由で生成を拒否しました(カテゴリ: bio)。記事内容を確認するか、別のモデルで再実行してください。'
    );
    expect(result.kind).toBe('refusal');
    expect(result.actions).toEqual(['chooseOtherModel']);
    expect(result.description).toContain('最初から作り直す');
  });

  it('treats OpenAI text refusals and safety blocks as refusals', () => {
    expect(explainError(new Error('AIが拒否しました: cannot help')).kind).toBe('refusal');
    const safety = explainError('400 Your request was rejected as a result of our safety system.');
    expect(safety.kind).toBe('refusal');
    expect(safety.actions).toContain('chooseOtherModel');
    expect(safety.title).not.toContain('記事');
  });

  it('asks to wait on rate limits', () => {
    expect(explainError('429 Too Many Requests').kind).toBe('rate_limit');
    expect(explainError('x', { kind: 'rate_limit' }).actions).toEqual(['retry']);
  });

  it('explains export conflicts without the internal marker', () => {
    const result = explainError(ipc(renderConflictMessage('render')));
    expect(result.kind).toBe('conflict');
    expect(result.title).toBe('書き出しを待つ間に動画の内容が変わりました');
    expect(result.detail).not.toContain('[RENDER_CONFLICT]');
    expect(explainError(renderConflictMessage('preview')).title).toBe(
      'プレビューを待つ間にシーンの内容が変わりました'
    );
  });

  it('explains a stalled export (watchdog) instead of a network problem', () => {
    // electron/video/watchdog.ts の stallErrorMessage(90_000, 'シーン 2 の動画化') と同じ文
    const message =
      '動画の書き出しが90秒以上進まなかったため中断しました(シーン 2 の動画化、timeout)。ほかのアプリを閉じるか、解像度を下げてから、もう一度書き出してください。';
    // 自動生成ジョブでは「一時的な失敗」に分類されるが、画面では書き出しの中断として説明する
    const kind = classifyGenerationError(new Error(message)).kind;
    expect(kind).toBe('transient');
    for (const result of [explainError(ipc(message)), explainError(message, { kind })]) {
      expect(result.kind).toBe('stalled');
      expect(result.actions).toEqual(['openVideoSettings', 'retry']);
      expect(result.detail).toContain('90秒以上進まなかった');
    }
  });

  it('distinguishes input changes during a job from conflicts', () => {
    expect(
      explainError('生成中に入力が変更されました。生成結果はジョブ履歴に保全しています。').kind
    ).toBe('input_changed');
  });

  it('does not mistake a file permission error for an API key problem', () => {
    expect(explainError("EACCES: permission denied, open '/tmp/x'").kind).toBe('storage');
    expect(explainError('ENOSPC: no space left on device').kind).toBe('storage');
  });

  it('detects network problems and busy states', () => {
    expect(explainError('fetch failed').kind).toBe('network');
    expect(explainError('connect ECONNREFUSED 127.0.0.1:443').kind).toBe('network');
    expect(explainError('Connection refused').kind).toBe('network');
    expect(explainError('x', { kind: 'transient' }).kind).toBe('network');
    expect(explainError('529 overloaded_error').title).toBe('AI サービスが混み合っています');
    expect(explainError('TTS APIの応答がタイムアウトしました（60秒）').title).toBe(
      'AI サービスから応答がありませんでした'
    );
    expect(explainError('別の動画処理が実行中です').kind).toBe('busy');
    expect(explainError('このプロジェクトは生成中です。').kind).toBe('busy');
  });

  it('asks for the article when it is missing', () => {
    expect(explainError('記事タイトルと本文を入力してください。')).toMatchObject({
      kind: 'article_missing',
      actions: [],
    });
  });

  it('shows short Japanese messages as they are, in the screen terms', () => {
    const result = explainError(
      new Error(
        "Error invoking remote method 'image:importData': Error: 画像は50MB以内で指定してください。"
      )
    );
    expect(result.kind).toBe('unknown');
    expect(result.description).toBe('画像は50MB以内で指定してください。');
    expect(explainError('読み上げるパートのスクリプトが空です').description).toBe(
      '読み上げるシーンの台本が空です'
    );
  });

  it('falls back to a generic message with the details kept', () => {
    const result = explainError(new Error('Something odd happened'));
    expect(result.kind).toBe('unknown');
    expect(result.detail).toBe('Something odd happened');
    expect(result.actions).toEqual(['retry']);
    const typeError = explainError(
      new Error('TypeError: Cannot read properties of undefined (reading "foo")')
    );
    expect(typeError.description).not.toContain('TypeError');
    expect(typeError.detail).toContain('Cannot read properties');
  });
});

describe('explainFailures', () => {
  it('explains the first failure and lists the failed scenes', () => {
    const result = explainFailures([
      { label: 'シーン2', error: new Error('429 rate limit') },
      { label: 'シーン5', error: new Error('boom') },
    ]);
    expect(result.kind).toBe('rate_limit');
    expect(result.description).toContain('AI サービスの利用上限に達しました');
    expect(result.description).toContain('シーン2・シーン5');
    expect(result.detail).toBe('シーン2: 429 rate limit\nシーン5: boom');
  });

  it('shortens a long list of scenes', () => {
    const failures = Array.from({ length: 7 }, (_, index) => ({
      label: `シーン${index + 1}`,
      error: 'boom',
    }));
    expect(explainFailures(failures).description).toContain(
      'シーン1・シーン2・シーン3・シーン4・シーン5 ほか'
    );
  });
});

describe('errorToastContent', () => {
  it('uses the cause as the message when the failed action is given', () => {
    expect(
      errorToastContent(explainError('429 Too Many Requests'), '画像を作れませんでした')
    ).toEqual({
      title: '画像を作れませんでした',
      message: 'AI サービスの利用上限に達しました',
    });
    expect(
      errorToastContent(explainError('画像がありません。'), '動画を書き出せませんでした').message
    ).toBe('画像がまだないシーンがあります');
  });

  it('shows the Japanese message itself for unknown errors', () => {
    expect(errorToastContent(explainError('出力先が未指定です'), '書き出せませんでした')).toEqual({
      title: '書き出せませんでした',
      message: '出力先が未指定です',
    });
    expect(errorToastContent(explainError('429'))).toEqual({
      title: 'AI サービスの利用上限に達しました',
      message: expect.stringContaining('少し時間をおいて'),
    });
  });
});
