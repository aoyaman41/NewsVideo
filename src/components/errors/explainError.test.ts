import { describe, expect, it } from 'vitest';
import { renderConflictMessage } from '../../../shared/project/renderIntent';
import { cleanErrorMessage, explainError } from './explainError';

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
  });

  it('treats 401 and authentication kinds as an unusable key', () => {
    expect(explainError('接続失敗: 401 Unauthorized').kind).toBe('authentication');
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

  it('asks to wait on rate limits', () => {
    expect(explainError('429 Too Many Requests').kind).toBe('rate_limit');
    expect(explainError('x', { kind: 'rate_limit' }).actions).toEqual(['retry']);
  });

  it('explains export conflicts without the internal marker', () => {
    const result = explainError(ipc(renderConflictMessage('render')));
    expect(result.kind).toBe('conflict');
    expect(result.detail).not.toContain('[RENDER_CONFLICT]');
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
    expect(explainError('別の動画処理が実行中です').kind).toBe('busy');
    expect(explainError('このプロジェクトは生成中です。').kind).toBe('busy');
  });

  it('asks for the article when it is missing', () => {
    expect(explainError('記事タイトルと本文を入力してください。')).toMatchObject({
      kind: 'article_missing',
      actions: [],
    });
  });

  it('falls back to a generic message with the details kept', () => {
    const result = explainError(new Error('Something odd happened'));
    expect(result.kind).toBe('unknown');
    expect(result.detail).toBe('Something odd happened');
    expect(result.actions).toEqual(['retry']);
  });
});
