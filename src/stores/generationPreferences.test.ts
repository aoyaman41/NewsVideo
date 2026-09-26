import { describe, expect, it, vi } from 'vitest';
import { normalizeSettings } from '../../shared/settings/appSettings';
import {
  budgetToUsd,
  createSerialSettingsSaver,
  DEFAULT_GENERATION_PREFERENCES,
  forgetLegacyGenerationPreferences,
  LEGACY_PREFERENCES_STORAGE_KEY,
  legacyPreferencesToSettings,
  migrateLegacyGenerationPreferences,
  preferencesFromSettings,
  preferencesToSettings,
  type GenerationPreferencesUpdate,
} from './generationPreferences';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
  };
}

it('defaults to fully automatic generation with the previous budget', () => {
  expect(DEFAULT_GENERATION_PREFERENCES).toEqual({ mode: 'automatic', budgetUsd: '5' });
  expect(preferencesFromSettings(normalizeSettings({}))).toEqual(DEFAULT_GENERATION_PREFERENCES);
  expect(
    preferencesFromSettings(
      normalizeSettings({ generationMode: 'review', generationBudgetUsd: null })
    )
  ).toEqual({ mode: 'review', budgetUsd: '' });
});

it('turns the budget text into the value passed to the job', () => {
  expect(budgetToUsd('')).toBeUndefined();
  expect(budgetToUsd('  ')).toBeUndefined();
  expect(budgetToUsd('2.5')).toBe(2.5);
  expect(budgetToUsd('0')).toBe(0);
  expect(budgetToUsd('-1')).toBeUndefined();
  expect(budgetToUsd('abc')).toBeUndefined();
});

it('turns screen edits into settings updates', () => {
  expect(preferencesToSettings({ mode: 'review' })).toEqual({ generationMode: 'review' });
  expect(preferencesToSettings({ budgetUsd: '2.5' })).toEqual({ generationBudgetUsd: 2.5 });
  expect(preferencesToSettings({ budgetUsd: '' })).toEqual({ generationBudgetUsd: null });
  expect(preferencesToSettings({})).toEqual({});
});

describe('legacy localStorage values', () => {
  it('converts the saved mode and budget text', () => {
    expect(legacyPreferencesToSettings(null)).toBeNull();
    expect(legacyPreferencesToSettings(JSON.stringify({ mode: 'review', budgetUsd: '' }))).toEqual({
      generationMode: 'review',
      generationBudgetUsd: null,
    });
    expect(
      legacyPreferencesToSettings(JSON.stringify({ mode: 'automatic', budgetUsd: '3' }))
    ).toEqual({ generationMode: 'automatic', generationBudgetUsd: 3 });
    expect(legacyPreferencesToSettings(JSON.stringify({ mode: 'other', budgetUsd: 3 }))).toEqual(
      {}
    );
    expect(legacyPreferencesToSettings('not json')).toEqual({});
  });

  it('moves the values to the settings once and removes the old key', async () => {
    const storage = memoryStorage({
      [LEGACY_PREFERENCES_STORAGE_KEY]: JSON.stringify({ mode: 'review', budgetUsd: '1.5' }),
    });
    const save = vi.fn(async (_update: GenerationPreferencesUpdate) => ({ success: true }));

    await expect(migrateLegacyGenerationPreferences(storage, save)).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith({ generationMode: 'review', generationBudgetUsd: 1.5 });
    expect(storage.values.has(LEGACY_PREFERENCES_STORAGE_KEY)).toBe(false);

    await expect(migrateLegacyGenerationPreferences(storage, save)).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps the old key when saving fails, to try again next time', async () => {
    const storage = memoryStorage({
      [LEGACY_PREFERENCES_STORAGE_KEY]: JSON.stringify({ mode: 'review', budgetUsd: '' }),
    });
    const save = vi.fn(async () => {
      throw new Error('disk full');
    });
    await expect(migrateLegacyGenerationPreferences(storage, save)).rejects.toThrow('disk full');
    expect(storage.values.has(LEGACY_PREFERENCES_STORAGE_KEY)).toBe(true);
  });

  it('forgets the old value once new preferences are saved', async () => {
    const storage = memoryStorage({
      [LEGACY_PREFERENCES_STORAGE_KEY]: JSON.stringify({ mode: 'review', budgetUsd: '' }),
    });
    forgetLegacyGenerationPreferences(storage);
    const save = vi.fn(async () => ({ success: true }));
    // 移行に失敗して鍵が残っていても、新しく保存したあとは古い値を移し直さない
    await expect(migrateLegacyGenerationPreferences(storage, save)).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('removes a broken value without saving anything', async () => {
    const storage = memoryStorage({ [LEGACY_PREFERENCES_STORAGE_KEY]: '{broken' });
    const save = vi.fn(async () => ({ success: true }));
    await expect(migrateLegacyGenerationPreferences(storage, save)).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });
});

it('saves updates one at a time and merges the ones that arrive meanwhile', async () => {
  const calls: GenerationPreferencesUpdate[] = [];
  let release: () => void = () => {};
  const save = vi.fn(
    (update: GenerationPreferencesUpdate) =>
      new Promise<void>((resolve) => {
        calls.push(update);
        release = resolve;
      })
  );
  const saveSerial = createSerialSettingsSaver(save);

  const first = saveSerial({ generationBudgetUsd: 1 });
  void saveSerial({ generationBudgetUsd: 12 });
  void saveSerial({ generationMode: 'review' });
  expect(calls).toEqual([{ generationBudgetUsd: 1 }]);

  release();
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]).toEqual({ generationBudgetUsd: 12, generationMode: 'review' });
  release();
  await first;
  expect(save).toHaveBeenCalledTimes(2);
});
