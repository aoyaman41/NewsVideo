import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEMINI_TTS_MODEL,
  GEMINI_TTS_MODELS,
  getSupportedGeminiThinkingLevels,
  getGeminiTtsModelCapabilities,
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
// Claude 関連は TTS 側の変更と衝突しないよう別の import にまとめる
import {
  ANTHROPIC_TEXT_COMPLETION_MODELS,
  CLAUDE_EFFORTS,
  getDefaultClaudeEffort,
  getSupportedClaudeEfforts,
  isAnthropicTextCompletionModel,
  isClaudeEffort,
  isGeminiTextCompletionModel,
} from './models';
// GPT Image 2.5 関連も他の変更と衝突しないよう別の import にまとめる
import {
  DEFAULT_IMAGE_MODEL,
  getImageModelLabel,
  getImageModelProvider,
  IMAGE_MODELS,
  isGeminiImageModel,
  isImageModel,
  isOpenAIImageModel,
  OPENAI_IMAGE_MODELS,
} from './models';

describe('text completion models', () => {
  it('composes the selector list from OpenAI, Gemini and Anthropic provider lists', () => {
    expect(TEXT_COMPLETION_MODELS).toEqual([
      ...OPENAI_TEXT_COMPLETION_MODELS,
      ...GEMINI_TEXT_COMPLETION_MODELS,
      ...ANTHROPIC_TEXT_COMPLETION_MODELS,
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

describe('Claude text completion models', () => {
  it('registers Claude Opus 5.5 as a labeled Anthropic model without a date suffix', () => {
    expect(ANTHROPIC_TEXT_COMPLETION_MODELS).toEqual(['claude-opus-5-5']);
    expect(isAnthropicTextCompletionModel('claude-opus-5-5')).toBe(true);
    expect(isOpenAITextCompletionModel('claude-opus-5-5')).toBe(false);
    expect(isGeminiTextCompletionModel('claude-opus-5-5')).toBe(false);
    expect(getTextCompletionModelLabel('claude-opus-5-5')).toBe('Claude Opus 5.5');
  });

  it.each([
    ['gpt-5.2', 'openai'],
    ['gemini-3.1-pro', 'gemini'],
    ['claude-opus-5-5', 'anthropic'],
  ] as const)('resolves the provider of %s to %s', (model, provider) => {
    expect(getTextCompletionModelProvider(model)).toBe(provider);
  });

  it('rejects unknown Claude model ids', () => {
    expect(isAnthropicTextCompletionModel('claude-opus-5-5-20260901')).toBe(false);
    expect(isAnthropicTextCompletionModel(undefined)).toBe(false);
  });

  it('offers every documented effort for Opus 5.5 and defaults to high', () => {
    expect(CLAUDE_EFFORTS).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(getSupportedClaudeEfforts('claude-opus-5-5')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(getDefaultClaudeEffort('claude-opus-5-5')).toBe('high');
  });

  it('validates the persisted effort vocabulary', () => {
    expect(isClaudeEffort('xhigh')).toBe(true);
    expect(isClaudeEffort('default')).toBe(true);
    expect(isClaudeEffort('none')).toBe(false);
    expect(isClaudeEffort('minimal')).toBe(false);
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
  it('lists Gemini 3.8 Flash / Flash-Lite TTS first and uses 3.8 Flash TTS as the default', () => {
    expect(GEMINI_TTS_MODELS.slice(0, 2)).toEqual([
      'gemini-3.8-flash-tts',
      'gemini-3.8-flash-lite-tts',
    ]);
    expect(DEFAULT_GEMINI_TTS_MODEL).toBe('gemini-3.8-flash-tts');
    expect(isGeminiTtsModel('gemini-3.8-flash-tts')).toBe(true);
    expect(isGeminiTtsModel('gemini-3.8-flash-lite-tts')).toBe(true);
    expect(getGeminiTtsModelLabel('gemini-3.8-flash-tts')).toBe('Gemini 3.8 Flash TTS');
    expect(getGeminiTtsModelLabel('gemini-3.8-flash-lite-tts')).toBe('Gemini 3.8 Flash-Lite TTS');
  });

  it('keeps Gemini 3.1 Flash TTS selectable', () => {
    expect(isGeminiTtsModel('gemini-3.1-flash-tts-preview')).toBe(true);
    expect(getGeminiTtsModelLabel('gemini-3.1-flash-tts-preview')).toBe(
      'Gemini 3.1 Flash TTS Preview'
    );
  });

  it('marks only the 3.8 models as verbatim-transcript models with WAV output', () => {
    expect(getGeminiTtsModelCapabilities('gemini-3.8-flash-tts')).toEqual({
      styleViaSpeechMetadata: true,
      defaultAudioFormat: 'wav',
    });
    expect(getGeminiTtsModelCapabilities('gemini-3.8-flash-lite-tts')).toEqual({
      styleViaSpeechMetadata: true,
      defaultAudioFormat: 'wav',
    });
    for (const model of [
      'gemini-3.1-flash-tts-preview',
      'gemini-2.5-pro-preview-tts',
      'gemini-2.5-flash-preview-tts',
    ] as const) {
      expect(getGeminiTtsModelCapabilities(model)).toEqual({
        styleViaSpeechMetadata: false,
        defaultAudioFormat: 'pcm',
      });
    }
  });
});

describe('OpenAI image models', () => {
  it('lists GPT Image 2.5 Sunburst and Flare before GPT Image 2 without date suffixes', () => {
    expect(OPENAI_IMAGE_MODELS).toEqual([
      'gpt-image-2.5-sunburst',
      'gpt-image-2.5-flare',
      'gpt-image-2',
    ]);
    expect(IMAGE_MODELS.slice(0, 3)).toEqual(OPENAI_IMAGE_MODELS);
  });

  it.each([
    ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'],
    ['gpt-image-2.5-flare', 'GPT Image 2.5 Flare'],
    ['gpt-image-2', 'GPT Image 2'],
  ] as const)('registers %s as a labeled OpenAI image model', (model, label) => {
    expect(isImageModel(model)).toBe(true);
    expect(isOpenAIImageModel(model)).toBe(true);
    expect(isGeminiImageModel(model)).toBe(false);
    expect(getImageModelProvider(model)).toBe('openai');
    expect(getImageModelLabel(model)).toBe(label);
  });

  it('keeps Gemini image models on the Gemini provider and the default unchanged', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('gemini-3.1-flash-image-preview');
    expect(getImageModelProvider('gemini-3.1-flash-image-preview')).toBe('gemini');
    expect(getImageModelProvider('gemini-3-pro-image-preview')).toBe('gemini');
    expect(isOpenAIImageModel('gemini-3.1-flash-image-preview')).toBe(false);
  });

  it('rejects dated snapshots and unknown GPT Image ids', () => {
    expect(isImageModel('gpt-image-2.5-sunburst-2026-09-08')).toBe(false);
    expect(isOpenAIImageModel('gpt-image-2.5-flare-2026-09-08')).toBe(false);
    expect(isOpenAIImageModel('gpt-image-2.5')).toBe(false);
    expect(isOpenAIImageModel(undefined)).toBe(false);
  });
});
