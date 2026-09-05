import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  getSupportedGeminiThinkingLevels,
  getGeminiTtsModelLabel,
  isGeminiTtsModel,
  GEMINI_TEXT_COMPLETION_MODELS,
  OPENAI_REASONING_EFFORTS,
  OPENAI_TEXT_COMPLETION_MODELS,
  TEXT_COMPLETION_MODELS,
  getDefaultOpenAIReasoningEffort,
  getCommonSupportedOpenAIReasoningEfforts,
  getSupportedOpenAIReasoningEfforts,
  getTextCompletionModelLabel,
  getTextCompletionModelProvider,
  isOpenAITextCompletionModel,
  supportsOpenAITemperature,
} from './models';

describe('text completion models', () => {
  it('composes the selector list from OpenAI and Gemini provider lists', () => {
    expect(TEXT_COMPLETION_MODELS).toEqual([
      ...OPENAI_TEXT_COMPLETION_MODELS,
      ...GEMINI_TEXT_COMPLETION_MODELS,
    ]);
  });

  it.each([
    ['gpt-5.6-sol', 'GPT-5.6 Sol'],
    ['gpt-5.6-terra', 'GPT-5.6 Terra'],
    ['gpt-5.6-luna', 'GPT-5.6 Luna'],
  ] as const)('registers %s as a labeled OpenAI model', (model, label) => {
    expect(isOpenAITextCompletionModel(model)).toBe(true);
    expect(getTextCompletionModelProvider(model)).toBe('openai');
    expect(getTextCompletionModelLabel(model)).toBe(label);
  });
});

describe('OpenAI reasoning efforts', () => {
  const gpt56Efforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'offers the documented GPT-5.6 efforts for %s',
    (model) => {
      expect(getSupportedOpenAIReasoningEfforts(model)).toEqual(gpt56Efforts);
      expect(getDefaultOpenAIReasoningEffort(model)).toBe('medium');
    }
  );

  it.each(['gpt-5.4', 'gpt-5.2'] as const)(
    'does not offer unsupported minimal or max effort for %s',
    (model) => {
      expect(getSupportedOpenAIReasoningEfforts(model)).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
      ]);
      expect(getDefaultOpenAIReasoningEffort(model)).toBe('none');
    }
  );

  it('keeps max in the persisted effort vocabulary', () => {
    expect(OPENAI_REASONING_EFFORTS).toContain('max');
  });

  it('returns only efforts shared by every selected OpenAI model', () => {
    expect(getCommonSupportedOpenAIReasoningEfforts(['gpt-5.6-sol', 'gpt-5.2'])).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(getCommonSupportedOpenAIReasoningEfforts([])).toEqual([]);
  });
});

describe('supportsOpenAITemperature', () => {
  it('allows temperature only for verified legacy model and effort combinations', () => {
    expect(supportsOpenAITemperature('gpt-5.2', 'none')).toBe(true);
    expect(supportsOpenAITemperature('gpt-5.4', 'none')).toBe(true);
    expect(supportsOpenAITemperature('gpt-5.6-sol', 'none')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.6-terra', 'none')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.6-luna', 'none')).toBe(false);
  });

  it('disables temperature for omitted or non-none reasoning effort values', () => {
    expect(supportsOpenAITemperature('gpt-5.2', null)).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.2', 'default')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.2', 'minimal')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.5', 'high')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.4', 'high')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.4', 'xhigh')).toBe(false);
    expect(supportsOpenAITemperature('gpt-5.6-sol', 'max')).toBe(false);
  });
});

describe('GPT-6 Astra', () => {
  it('restricts reasoning to supported efforts across mixed model selections', () => {
    expect(getTextCompletionModelLabel('gpt-6-astra')).toBe('GPT-6 Astra');
    expect(getDefaultOpenAIReasoningEffort('gpt-6-astra')).toBe('medium');
    expect(getCommonSupportedOpenAIReasoningEfforts(['gpt-6-astra', 'gpt-5.2'])).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(supportsOpenAITemperature('gpt-6-astra', 'low')).toBe(false);
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
    expect(getSupportedGeminiThinkingLevels('gemini-3.1-pro')).toEqual(['low', 'medium', 'high']);
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
