import { useSyncExternalStore } from 'react';

/**
 * 自動生成の「進め方」と「予算の上限」の既定値。記事画面の詳細設定と設定画面の詳細設定の両方から
 * 変更でき、次に「おまかせで作る」を押したときに使う。ジョブ自体は開始時の値を保存しているので、
 * 「続きから」はジョブに保存された値で再開する。
 * 設定ファイル(settings.json)のスキーマを変えないよう、この Mac の画面側だけで覚える。
 */
export type GenerationMode = 'automatic' | 'review';
export type GenerationPreferences = {
  mode: GenerationMode;
  /** 空文字なら上限なし。USD の文字列(入力途中の値も保持する) */
  budgetUsd: string;
};

const STORAGE_KEY = 'newsvideo.generationPreferences.v1';
// 既定は全自動(ユーザー決定 2026-09-26)。予算の既定値は従来の記事画面の初期値を引き継ぐ
export const DEFAULT_GENERATION_PREFERENCES: GenerationPreferences = {
  mode: 'automatic',
  budgetUsd: '5',
};

const listeners = new Set<() => void>();
let cached: GenerationPreferences | null = null;

export function parseGenerationPreferences(raw: string | null | undefined): GenerationPreferences {
  if (!raw) return DEFAULT_GENERATION_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Partial<GenerationPreferences>;
    return {
      mode: value.mode === 'review' ? 'review' : 'automatic',
      budgetUsd:
        typeof value.budgetUsd === 'string'
          ? value.budgetUsd
          : DEFAULT_GENERATION_PREFERENCES.budgetUsd,
    };
  } catch {
    return DEFAULT_GENERATION_PREFERENCES;
  }
}

/** 予算の入力値を jobs.start に渡す値にする。空欄・不正・負の値は上限なし(undefined) */
export function budgetToUsd(budgetUsd: string): number | undefined {
  const trimmed = budgetUsd.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function read(): GenerationPreferences {
  if (cached) return cached;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  cached = parseGenerationPreferences(raw);
  return cached;
}

export function getGenerationPreferences(): GenerationPreferences {
  return read();
}

export function setGenerationPreferences(patch: Partial<GenerationPreferences>): void {
  cached = { ...read(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    /* 覚えられなくても今回の値は使える */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useGenerationPreferences() {
  const preferences = useSyncExternalStore(subscribe, read);
  return [preferences, setGenerationPreferences] as const;
}
