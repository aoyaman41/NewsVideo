import { stripRenderConflictMarker } from '../../../shared/project/renderIntent';

/**
 * 例外の文字列をそのまま画面に出さず、原因と次の操作に言い換える(表示専用)。
 * 元の文字列は「詳しい内容」として折りたたみで見られるようにする。
 */

export type ErrorAction =
  /** 設定画面の API キーを開く */
  | 'openApiKeys'
  /** 設定画面の生成モデルを開く(別のモデルで再実行する) */
  | 'chooseOtherModel'
  /** 同じ操作をもう一度試す(自動生成なら「続きから」) */
  | 'retry';

export type ErrorExplanation = {
  /** 分類。テストと表示の出し分けに使う */
  kind:
    | 'api_key_missing'
    | 'authentication'
    | 'refusal'
    | 'rate_limit'
    | 'network'
    | 'conflict'
    | 'input_changed'
    | 'busy'
    | 'storage'
    | 'article_missing'
    | 'missing_assets'
    | 'cancelled'
    | 'unknown';
  title: string;
  description: string;
  actions: ErrorAction[];
  /** 折りたたみで見せる元のエラー文(キーらしき文字列は伏せる)。言い換えと同じなら空文字 */
  detail: string;
};

const SERVICE_NAMES: Array<[RegExp, string]> = [
  [/anthropic|claude/i, 'Anthropic'],
  [/openai|gpt/i, 'OpenAI'],
  [/google|gemini/i, 'Google'],
];

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** IPC の前置き(Error invoking remote method 'x': Error: )や目印を取り除き、キーらしき文字列を伏せる */
export function cleanErrorMessage(error: unknown): string {
  let message = toMessage(error).trim();
  message = message.replace(/^Error invoking remote method '[^']*':\s*/i, '');
  while (/^(?:[A-Za-z]*Error):\s*/.test(message))
    message = message.replace(/^[A-Za-z]*Error:\s*/, '');
  message = stripRenderConflictMarker(message);
  message = message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[キーを伏せました]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[キーを伏せました]')
    .replace(/(key=)[^&\s"']+/gi, '$1[キーを伏せました]');
  return message.length > 800 ? `${message.slice(0, 800)}…` : message;
}

function serviceIn(message: string): string | null {
  for (const [pattern, name] of SERVICE_NAMES) if (pattern.test(message)) return name;
  return null;
}

function explanation(
  kind: ErrorExplanation['kind'],
  title: string,
  description: string,
  actions: ErrorAction[],
  detail: string
): ErrorExplanation {
  return { kind, title, description, actions, detail };
}

/**
 * @param error 例外、またはエラー文
 * @param hint 自動生成ジョブの分類(job.error.kind)が分かっている場合に渡す
 */
export function explainError(error: unknown, hint?: { kind?: string }): ErrorExplanation {
  const detail = cleanErrorMessage(error);
  const kind = hint?.kind;

  if (/APIキーが(?:設定されていません|未設定)|api.?key.*(?:not set|missing)/i.test(detail)) {
    const service = serviceIn(detail);
    return explanation(
      'api_key_missing',
      service ? `${service} の API キーが設定されていません` : 'API キーが設定されていません',
      '設定画面で API キーを入力してから、もう一度お試しください。自動生成は止まったところから再開できます。',
      ['openApiKeys', 'retry'],
      detail
    );
  }

  if (/ENOSPC|no space left/i.test(detail)) {
    return explanation(
      'storage',
      '保存できませんでした(空き容量が足りません)',
      'Mac の空き容量を増やしてから、もう一度お試しください。',
      ['retry'],
      detail
    );
  }

  if (/EACCES|EPERM/.test(detail)) {
    return explanation(
      'storage',
      'ファイルを保存できませんでした',
      '保存先に書き込めない状態です。少し待ってから、もう一度お試しください。',
      ['retry'],
      detail
    );
  }

  if (/生成を拒否|AIが拒否|\brefusal\b/i.test(detail)) {
    return explanation(
      'refusal',
      'AI がこの記事の生成を断りました',
      'AI の安全上の判定で生成が止まりました。記事の内容を見直すか、設定の「生成モデル」で文章を作るモデルを別のもの(例: GPT-5.6 Terra)に変えてから、記事画面の「最初から作り直す」で再実行してください。',
      ['chooseOtherModel'],
      detail
    );
  }

  if (
    kind === 'authentication' ||
    /\b40[13]\b|unauthori[sz]ed|invalid.{0,12}(?:api.?)?key|authenticat|forbidden/i.test(detail)
  ) {
    const service = serviceIn(detail);
    return explanation(
      'authentication',
      service ? `${service} の API キーが使えません` : 'API キーが使えません',
      'キーが正しくないか、無効になっています。設定画面でキーを貼り直して「保存して確認」を押してください。サービス側の支払い設定や利用権限も確認してください。',
      ['openApiKeys', 'retry'],
      detail
    );
  }

  if (
    kind === 'rate_limit' ||
    /\b429\b|rate.?limit|too many requests|quota|resource.?exhausted/i.test(detail)
  ) {
    return explanation(
      'rate_limit',
      'AI サービスの利用上限に達しました',
      '少し時間をおいてから「もう一度試す」を押してください。何度も続く場合は、サービスの利用枠や支払い設定を確認してください。',
      ['retry'],
      detail
    );
  }

  if (/生成中に入力が変更されました/.test(detail)) {
    return explanation(
      'input_changed',
      '生成中に記事や台本が変更されました',
      '作ったものは保存されています。「続きから」を押すと、変更に合わせて作り直します。',
      ['retry'],
      detail
    );
  }

  if (
    kind === 'conflict' ||
    /順番を待つ間に|保存後にプロジェクトが変更|CONFLICT|競合|変更されました/i.test(detail)
  ) {
    return explanation(
      'conflict',
      '処理の途中で内容が変わりました',
      '最新の内容を読み込んでから、もう一度お試しください。',
      ['retry'],
      detail
    );
  }

  if (/別の動画処理が実行中|生成中です|実行中です/.test(detail)) {
    return explanation(
      'busy',
      'ほかの処理が実行中です',
      '終わるまで待ってから、もう一度お試しください。自動生成を止めるときは、画面上部の「停止」を押してください。',
      ['retry'],
      detail
    );
  }

  if (/記事タイトルと本文を入力/.test(detail)) {
    return explanation(
      'article_missing',
      '記事のタイトルと本文を入力してください',
      '記事画面でタイトルと本文を入力してから、もう一度お試しください。',
      [],
      ''
    );
  }

  if (/音声未生成|音声ファイルが見つかりません/.test(detail)) {
    return explanation(
      'missing_assets',
      '音声がまだないシーンがあります',
      '音声画面で、足りないシーンの音声を作ってから、もう一度お試しください。',
      [],
      detail
    );
  }

  if (/画像未割り当て|画像が見つかりません|画像がありません/.test(detail)) {
    return explanation(
      'missing_assets',
      '画像がまだないシーンがあります',
      '画像画面で、足りないシーンの画像を作ってから、もう一度お試しください。',
      [],
      detail
    );
  }

  if (kind === 'cancelled' || /キャンセル|cancel/i.test(detail)) {
    return explanation(
      'cancelled',
      '停止しました',
      'できたものは保存されています。',
      ['retry'],
      ''
    );
  }

  if (
    kind === 'transient' ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|connection refused|fetch failed|network|timed? ?out|overloaded|(?:status|HTTP)\D{0,3}5\d\d|\b50[234]\b|\b529\b/i.test(
      detail
    )
  ) {
    return explanation(
      'network',
      'AI サービスに接続できませんでした',
      'インターネット接続を確認し、少し時間をおいてから「もう一度試す」を押してください。',
      ['retry'],
      detail
    );
  }

  if (kind === 'storage') {
    return explanation(
      'storage',
      'ファイルを保存できませんでした',
      '少し待ってから、もう一度お試しください。',
      ['retry'],
      detail
    );
  }

  return explanation(
    'unknown',
    '処理に失敗しました',
    'もう一度お試しください。解決しない場合は、下の「詳しい内容」を添えてお知らせください。',
    ['retry'],
    detail
  );
}
