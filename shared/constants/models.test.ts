import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  getSupportedGeminiThinkingLevels,
  getSupportedOpenAIReasoningEfforts,
  getGeminiTtsModelLabel,
  isGeminiTtsModel,
  supportsOpenAITemperature,
} from './models';

describe('supportsOpenAITemperature', () => {
  it('allows temperature only when reasoning effort is none for GPT-5 models', () => {
    expect(supportsOpenAITemperature('gpt-5.5', 'none')).toBe(true);
    expect(supportsOpenAITemperature('gpt-5.2', 'none')).toBe(true);
    expect(supportsOpenAITemperature('gpt-5.4', 'none')).toBe(true);
  });

  it('disables temperature for omitted or non-none reasoning effort values', () => {
    expect(supportsOpenAITemperature('gpt-5.2', null)).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.2', 'default')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.2', 'minimal')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.5', 'high')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.4', 'high')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.4', 'xhigh')).toBe(false);
  });

  it('does not offer minimal reasoning for GPT-5.5', () => {
    expect(getSupportedOpenAIReasoningEfforts('gpt-5.5')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });
});

describe('getSupportedGeminiThinkingLevels', () => {
  it('offers all Gemini 3.1 Pro thinking levels supported by the API', () => {
    expect(getSupportedGeminiThinkingLevels('gemini-3.1-pro')).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });
});

describe('Gemini TTS models', () => {
  it('includes Gemini 3.1 Flash TTS as the default selectable TTS model', () => {
    expect(DEFAULT_GEMINI_TTS_MODEL).toBe('gemini-3.1-flash-tts-preview');
    expect(isGeminiTtsModel('gemini-3.1-flash-tts-preview')).toBe(true);
    expect(getGeminiTtsModelLabel('gemini-3.1-flash-tts-preview')).toBe(
      'Gemini 3.1 Flash TTS Preview'
    );
  });
});
