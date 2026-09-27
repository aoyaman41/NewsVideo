import {
  DEFAULT_SETTINGS,
  GENERATION_MODES,
  type AppSettings,
  type GenerationMode,
} from '../../shared/settings/appSettings';

/**
 * 自動生成の「進め方」と「予算の上限」の既定値。保存先は AppSettings(settings.json の
 * generationMode / generationBudgetUsd)で、設定画面の「新しい動画」で変える。
 * 記事画面での変更はその回の生成だけに使い、既定値は変えない(M5)。ジョブ自体は開始時の値を
 * 保存しているので、「続きから」はジョブに保存された値で再開する。
 */
export type { GenerationMode };

/** 画面で扱う形。予算は入力途中の値も持てるよう文字列(空文字は上限なし) */
export type GenerationPreferences = {
  mode: GenerationMode;
  budgetUsd: string;
};

type PreferenceSettings = Pick<AppSettings, 'generationMode' | 'generationBudgetUsd'>;
export type GenerationPreferencesUpdate = Partial<PreferenceSettings>;

/** 以前(localStorage に保存していたころ)の保存場所。起動時に 1 回だけ AppSettings へ移して消す */
export const LEGACY_PREFERENCES_STORAGE_KEY = 'newsvideo.generationPreferences.v1';

export function preferencesFromSettings(settings: PreferenceSettings): GenerationPreferences {
  return {
    mode: settings.generationMode,
    budgetUsd: settings.generationBudgetUsd === null ? '' : String(settings.generationBudgetUsd),
  };
}

export const DEFAULT_GENERATION_PREFERENCES: GenerationPreferences =
  preferencesFromSettings(DEFAULT_SETTINGS);

/** 予算の入力値を jobs.start に渡す値にする。空欄・不正・負の値は上限なし(undefined) */
export function budgetToUsd(budgetUsd: string): number | undefined {
  const trimmed = budgetUsd.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function toMode(value: unknown): GenerationMode | undefined {
  return GENERATION_MODES.find((mode) => mode === value);
}

/** 画面での変更を、AppSettings の更新(settings.set に渡す値)にする */
export function preferencesToSettings(
  patch: Partial<GenerationPreferences>
): GenerationPreferencesUpdate {
  const update: GenerationPreferencesUpdate = {};
  if (patch.mode !== undefined) update.generationMode = toMode(patch.mode) ?? 'automatic';
  if (patch.budgetUsd !== undefined)
    update.generationBudgetUsd = budgetToUsd(patch.budgetUsd) ?? null;
  return update;
}

/**
 * localStorage に残っている以前の値を、AppSettings の更新にする。値がなければ null。
 * 壊れた値は空の更新(移すものはないが、鍵は消す)にする。
 */
export function legacyPreferencesToSettings(
  raw: string | null | undefined
): GenerationPreferencesUpdate | null {
  if (raw === null || raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object') return {};
  const legacy = value as { mode?: unknown; budgetUsd?: unknown };
  const update: GenerationPreferencesUpdate = {};
  const mode = toMode(legacy.mode);
  if (mode) update.generationMode = mode;
  if (typeof legacy.budgetUsd === 'string')
    update.generationBudgetUsd = budgetToUsd(legacy.budgetUsd) ?? null;
  return update;
}

type LegacyStorage = Pick<Storage, 'getItem' | 'removeItem'>;

/**
 * 以前の値があれば AppSettings へ移し、localStorage から消す(移したら二度と移さない)。
 * 保存に失敗したときは鍵を残し、次の起動でもう一度試す。移したら true。
 */
export async function migrateLegacyGenerationPreferences(
  storage: LegacyStorage | null,
  save: (update: GenerationPreferencesUpdate) => Promise<unknown>
): Promise<boolean> {
  if (!storage) return false;
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_PREFERENCES_STORAGE_KEY);
  } catch {
    return false;
  }
  const update = legacyPreferencesToSettings(raw);
  if (update === null) return false;
  if (Object.keys(update).length > 0) await save(update);
  try {
    storage.removeItem(LEGACY_PREFERENCES_STORAGE_KEY);
  } catch {
    /* 消せなくても、次の起動で同じ値をもう一度移すだけ */
  }
  return true;
}

function localStorageOrNull(): LegacyStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 進め方と予算を設定に保存できたら、以前の値は消す。移行に失敗して鍵が残っていても、
 * 次の起動で古い値を移し直して、新しく保存した値を上書きしないようにする。
 */
export function forgetLegacyGenerationPreferences(
  storage: LegacyStorage | null = localStorageOrNull()
): void {
  try {
    storage?.removeItem(LEGACY_PREFERENCES_STORAGE_KEY);
  } catch {
    /* 消せなくても、今回保存した値は使える */
  }
}

let migration: Promise<void> | null = null;

/**
 * 以前の値の移行を、アプリの起動後に 1 回だけ行う(何度呼んでも同じ Promise を返す)。
 * 進め方と予算を表示する画面は、設定を読む前にこれを待つ。
 */
export function ensureGenerationPreferencesMigrated(): Promise<void> {
  migration ??= migrateLegacyGenerationPreferences(localStorageOrNull(), (update) =>
    window.electronAPI.settings.set(update)
  ).then(
    () => undefined,
    (error) => {
      console.warn('Failed to migrate generation preferences:', error);
    }
  );
  return migration;
}
