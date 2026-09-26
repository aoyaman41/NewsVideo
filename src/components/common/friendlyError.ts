import { stripRenderConflictMarker } from '../../../shared/project/renderIntent';

/** 次に取れる操作。画面側でボタンにする */
export type ErrorNextAction = 'openSettings' | 'retry' | 'none';

export type FriendlyError = {
  /** 何に失敗したか(例:「画像を作れませんでした」) */
  title: string;
  /** 原因と次の操作を初心者向けに書いた文 */
  message: string;
  /** 例外の原文。「詳しい内容」の折りたたみに出す */
  details?: string;
  action: ErrorNextAction;
};

const JAPANESE = /[぀-ヿ一-鿿]/;

/** Electron の IPC が付ける前置きや "Error: " を取り除く */
export function rawErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return stripRenderConflictMarker(
    text
      .replace(/^Error invoking remote method '[^']*':\s*/i, '')
      .replace(/^(?:[A-Za-z]*Error:\s*)+/, '')
      .trim()
  ).trim();
}

/** 画面上の用語(シーン・台本)にそろえる */
function toScreenTerms(text: string): string {
  return text.replace(/パート/g, 'シーン').replace(/スクリプト|原稿/g, '台本');
}

type Rule = {
  test: RegExp;
  message: string | ((raw: string) => string);
  action: ErrorNextAction;
};

const RULES: Rule[] = [
  {
    test: /APIキーが(?:設定|登録)されていません|api[\s_-]?key[^.]*(?:not set|missing|not configured)/i,
    message: (raw) => {
      const provider = raw.match(/(OpenAI|Anthropic|Google(?: AI| TTS)?)\s*APIキー/)?.[1];
      return `${provider ? `${provider} の ` : ''}API キーが設定されていません。設定画面で入力してから、もう一度お試しください。`;
    },
    action: 'openSettings',
  },
  {
    test: /ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|network error/i,
    message: '通信がうまくいきませんでした。インターネット接続を確認して、もう一度お試しください。',
    action: 'retry',
  },
  {
    test: /AIが拒否しました|\brefusal\b|safety|PROHIBITED_CONTENT|content[\s_]policy|moderation/i,
    message:
      'AI が安全上の理由で生成を断りました。設定画面で別のモデルを選んでから、もう一度お試しください。',
    action: 'openSettings',
  },
  {
    test: /\b401\b|\b403\b|invalid[\s_-]?(?:x-)?api[\s_-]?key|incorrect api key|api key not valid|unauthori[sz]ed|authentication|permission[\s_]denied/i,
    message: 'API キーが正しくないか、使えない状態です。設定画面でキーを確認してください。',
    action: 'openSettings',
  },
  {
    test: /\b429\b|rate[\s_-]?limit|resource[\s_]exhausted|quota|too many requests/i,
    message: '利用の上限に達したか、混み合っています。しばらく待ってから、もう一度お試しください。',
    action: 'retry',
  },
  {
    test: /overloaded|\b529\b|\b503\b|\b502\b|service unavailable|timed? ?out|タイムアウト/i,
    message:
      'AI のサービスが混み合っているか、応答がありませんでした。しばらく待ってから、もう一度お試しください。',
    action: 'retry',
  },
];

/**
 * 例外を、原因と次の操作が分かる文に変える。原文は details に残す。
 * 既知のエラーでなく日本語で書かれた短い文は、そのまま(用語だけそろえて)見せる。
 */
export function describeError(error: unknown, title: string): FriendlyError {
  const raw = rawErrorText(error);
  for (const rule of RULES) {
    if (rule.test.test(raw)) {
      const message = typeof rule.message === 'function' ? rule.message(raw) : rule.message;
      return { title, message, details: raw || undefined, action: rule.action };
    }
  }
  if (raw && JAPANESE.test(raw) && raw.length <= 160 && !/\n\s+at /.test(raw)) {
    return { title, message: toScreenTerms(raw), details: raw, action: 'retry' };
  }
  return {
    title,
    message:
      'うまくいきませんでした。もう一度お試しください。続く場合は「詳しい内容」を確認してください。',
    details: raw || undefined,
    action: 'retry',
  };
}

/**
 * まとめて作る処理で、一部のシーンが失敗したときの表示。
 * 最初の失敗の原因と次の操作を示し、各シーンの原文は「詳しい内容」にまとめる。
 */
export function describeFailures(
  title: string,
  failures: Array<{ label: string; error: unknown }>
): FriendlyError {
  const first = describeError(failures[0]?.error, title);
  const labels = failures.map((failure) => failure.label);
  const shown = labels.length > 5 ? `${labels.slice(0, 5).join('・')} ほか` : labels.join('・');
  return {
    title,
    message: `${first.message}（うまくいかなかったシーン: ${shown}）`,
    details: failures
      .map((failure) => `${failure.label}: ${rawErrorText(failure.error)}`)
      .join('\n'),
    action: first.action,
  };
}
