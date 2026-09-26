import { expect, it } from 'vitest';
import {
  budgetToUsd,
  DEFAULT_GENERATION_PREFERENCES,
  parseGenerationPreferences,
} from './generationPreferences';

it('defaults to fully automatic generation', () => {
  expect(parseGenerationPreferences(null)).toEqual(DEFAULT_GENERATION_PREFERENCES);
  expect(DEFAULT_GENERATION_PREFERENCES.mode).toBe('automatic');
  expect(parseGenerationPreferences('not json')).toEqual(DEFAULT_GENERATION_PREFERENCES);
});

it('keeps the saved mode and budget text', () => {
  expect(parseGenerationPreferences(JSON.stringify({ mode: 'review', budgetUsd: '' }))).toEqual({
    mode: 'review',
    budgetUsd: '',
  });
  expect(parseGenerationPreferences(JSON.stringify({ mode: 'other', budgetUsd: 3 }))).toEqual({
    mode: 'automatic',
    budgetUsd: '5',
  });
});

it('turns the budget text into the value passed to the job', () => {
  expect(budgetToUsd('')).toBeUndefined();
  expect(budgetToUsd('  ')).toBeUndefined();
  expect(budgetToUsd('2.5')).toBe(2.5);
  expect(budgetToUsd('0')).toBe(0);
  expect(budgetToUsd('-1')).toBeUndefined();
  expect(budgetToUsd('abc')).toBeUndefined();
});
