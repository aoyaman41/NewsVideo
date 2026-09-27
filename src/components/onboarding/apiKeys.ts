import { cleanErrorMessage } from '../errors/explainError';
import {
  getImageModelProvider,
  getTextCompletionModelProvider,
  isImageModel,
  isTextCompletionModel,
  type ImageModel,
  type TextCompletionModel,
} from '../../../shared/constants/models';

export type ApiKeyService = 'anthropic' | 'openai' | 'google_ai';

/** ようこそ画面と設定画面で並べる順(既定の構成: 文章 Anthropic・画像 OpenAI・音声 Google) */
export const API_KEY_SERVICES: readonly ApiKeyService[] = ['anthropic', 'openai', 'google_ai'];

export const API_KEY_SERVICE_INFO: Record<
  ApiKeyService,
  { name: string; company: string; url: string; urlLabel: string }
> = {
  anthropic: {
    name: 'Anthropic',
    company: 'Claude',
    url: 'https://platform.claude.com/settings/keys',
    urlLabel: 'Claude の管理画面でキーを作る',
  },
  openai: {
    name: 'OpenAI',
    company: 'GPT',
    url: 'https://platform.openai.com/api-keys',
    urlLabel: 'OpenAI の管理画面でキーを作る',
  },
  google_ai: {
    name: 'Google',
    company: 'Gemini',
    url: 'https://aistudio.google.com/apikey',
    urlLabel: 'Google AI Studio でキーを作る',
  },
};

/** 生成に使う設定のうち、必要な API キーの判定に使う項目 */
export type ModelSelection = {
  scriptTextModel?: unknown;
  imagePromptTextModel?: unknown;
  imageModel?: unknown;
  ttsEngine?: unknown;
};

export type ServiceUsage = '台本' | '画像の指示' | '画像' | '音声';

function textService(model: TextCompletionModel): ApiKeyService {
  const provider = getTextCompletionModelProvider(model);
  return provider === 'gemini' ? 'google_ai' : provider;
}

function imageService(model: ImageModel): ApiKeyService {
  return getImageModelProvider(model) === 'openai' ? 'openai' : 'google_ai';
}

/** 今の設定で、それぞれのキーを何に使うか */
export function serviceUsages(settings: ModelSelection): Record<ApiKeyService, ServiceUsage[]> {
  const usages: Record<ApiKeyService, ServiceUsage[]> = {
    anthropic: [],
    openai: [],
    google_ai: [],
  };
  if (isTextCompletionModel(settings.scriptTextModel))
    usages[textService(settings.scriptTextModel)].push('台本');
  if (isTextCompletionModel(settings.imagePromptTextModel))
    usages[textService(settings.imagePromptTextModel)].push('画像の指示');
  if (isImageModel(settings.imageModel)) usages[imageService(settings.imageModel)].push('画像');
  // 音声は Gemini(Google)を使う。macOS の音声だけはキーが不要
  if (settings.ttsEngine !== 'macos_tts') usages.google_ai.push('音声');
  return usages;
}

/** 今の設定で自動生成に必要なキー(表示順) */
export function requiredServices(settings: ModelSelection): ApiKeyService[] {
  const usages = serviceUsages(settings);
  return API_KEY_SERVICES.filter((service) => usages[service].length > 0);
}

/** 用途を「台本と画像の指示」のように読みやすくつなぐ */
export function formatUsages(usages: readonly string[]): string {
  if (usages.length === 0) return '';
  if (usages.length === 1) return usages[0];
  return `${usages.slice(0, -1).join('・')}と${usages[usages.length - 1]}`;
}

export type ConnectionResult = { success: boolean; message: string; latencyMs?: number };

/**
 * 接続テストの結果を、初心者向けの短い説明にする。元の文は詳細として返す。
 * 詳細にはキーらしき文字列と、確認に使ったキーそのもの(secret)を伏せてから入れる。
 */
export function explainConnectionResult(
  result: ConnectionResult,
  secret?: string
): {
  ok: boolean;
  summary: string;
  detail: string;
} {
  let raw = cleanErrorMessage(result.message ?? '');
  const key = secret?.trim();
  if (key && key.length >= 4) raw = raw.split(key).join('[キーを伏せました]');
  if (result.success) return { ok: true, summary: '使えます', detail: '' };
  if (/APIキーが設定されていません/.test(raw))
    return { ok: false, summary: 'キーがまだ保存されていません。', detail: '' };
  const status = Number(raw.match(/接続失敗:\s*(\d{3})/)?.[1]);
  if (status === 401)
    return {
      ok: false,
      summary: 'キーが正しくありません。コピーし直して貼り付けてください。',
      detail: raw,
    };
  if (status === 403)
    return {
      ok: false,
      summary: 'このキーでは使えません。サービス側の権限や支払い設定を確認してください。',
      detail: raw,
    };
  if (status === 429)
    return {
      ok: false,
      summary: '利用上限に達しています。サービス側の利用枠や支払い設定を確認してください。',
      detail: raw,
    };
  if (status === 404)
    return {
      ok: false,
      summary: 'このキーでは既定のモデルを使えません。サービス側の利用権限を確認してください。',
      detail: raw,
    };
  if (status >= 500)
    return {
      ok: false,
      summary: 'サービス側が混み合っています。少し待ってから確認してください。',
      detail: raw,
    };
  if (/接続エラー/.test(raw))
    return {
      ok: false,
      summary: 'インターネットに接続できませんでした。接続を確認してください。',
      detail: raw,
    };
  return { ok: false, summary: 'このキーでは接続できませんでした。', detail: raw };
}
