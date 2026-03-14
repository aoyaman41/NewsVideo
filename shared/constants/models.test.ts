import { describe, expect, it } from 'vitest';
import { supportsOpenAITemperature } from './models';

describe('supportsOpenAITemperature', () => {
  it('allows temperature only when reasoning effort is none for GPT-5 models', () => {
    expect(supportsOpenAITemperature('gpt-5.2', 'none')).toBe(true);
    expect(supportsOpenAITemperature('gpt-5.4', 'none')).toBe(true);
  });

  it('disables temperature for omitted or non-none reasoning effort values', () => {
    expect(supportsOpenAITemperature('gpt-5.2', null)).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.2', 'default')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.2', 'minimal')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.4', 'high')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.4', 'xhigh')).toBe(false);
  });
});
