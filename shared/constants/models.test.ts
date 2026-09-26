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
// Gemini 画像の GA 化(M1)も他の変更と衝突しないよう別の import にまとめる
import {
  GEMINI_IMAGE_MODELS,
  imageModelFingerprintId,
  LEGACY_FALLBACK_GEMINI_IMAGE_MODEL,
  normalizeImageModelId,
} from './models';
// M3: 既定のテキストモデルと、選択肢から外した旧モデルの扱い
import {
  DEFAULT_IMAGE_PROMPT_TEXT_MODEL,
  DEFAULT_SCRIPT_TEXT_MODEL,
  LEGACY_GEMINI_TTS_MODELS,
  LEGACY_IMAGE_MODELS,
  LEGACY_TEXT_COMPLETION_MODELS,
  OPENAI_TEXT_COMPLETION_MODEL,
  SELECTABLE_GEMINI_TTS_MODELS,
  SELECTABLE_IMAGE_MODELS,
  SELECTABLE_TEXT_COMPLETION_MODELS,
  isTextCompletionModel,
  supportsOpenAIPromptCacheBreakpoint,
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

  it('offers every documented effort for Opus 5.5 and defaults to medium', () => {
    expect(CLAUDE_EFFORTS).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(getSupportedClaudeEfforts('claude-opus-5-5')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(getDefaultClaudeEffort('claude-opus-5-5')).toBe('medium');
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

  it('keeps max in the persisted effort vocabulary and drops the unsupported minimal', () => {
    expect(OPENAI_REASONING_EFFORTS).toContain('max');
    expect(OPENAI_REASONING_EFFORTS).not.toContain('minimal');
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
      angleBracketTags: true,
    });
    expect(getGeminiTtsModelCapabilities('gemini-3.8-flash-lite-tts')).toEqual({
      styleViaSpeechMetadata: true,
      defaultAudioFormat: 'wav',
      angleBracketTags: true,
    });
    for (const model of [
      'gemini-3.1-flash-tts-preview',
      'gemini-2.5-pro-preview-tts',
      'gemini-2.5-flash-preview-tts',
    ] as const) {
      expect(getGeminiTtsModelCapabilities(model)).toEqual({
        styleViaSpeechMetadata: false,
        defaultAudioFormat: 'pcm',
        angleBracketTags: false,
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

  it('defaults new settings to GPT Image 2.5 Sunburst', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('gpt-image-2.5-sunburst');
    expect(getImageModelProvider(DEFAULT_IMAGE_MODEL)).toBe('openai');
  });

  it.each([
    ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'],
    ['gemini-3-pro-image', 'Gemini 3 Pro Image'],
  ] as const)('registers the GA Gemini image model %s', (model, label) => {
    expect(GEMINI_IMAGE_MODELS).toContain(model);
    expect(isImageModel(model)).toBe(true);
    expect(isGeminiImageModel(model)).toBe(true);
    expect(isOpenAIImageModel(model)).toBe(false);
    expect(getImageModelProvider(model)).toBe('gemini');
    expect(getImageModelLabel(model)).toBe(label);
  });

  it.each([
    ['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image'],
    ['gemini-3-pro-image-preview', 'gemini-3-pro-image'],
  ] as const)('reads the shut-down preview id %s as its GA successor', (legacy, current) => {
    expect(isImageModel(legacy)).toBe(false);
    expect(normalizeImageModelId(legacy)).toBe(current);
    // 変更検知の指紋は、読み替えの前後で同じ値になる
    expect(imageModelFingerprintId(current)).toBe(legacy);
    expect(imageModelFingerprintId(legacy)).toBe(legacy);
  });

  it('leaves current and unknown image model ids unchanged', () => {
    for (const model of IMAGE_MODELS) expect(normalizeImageModelId(model)).toBe(model);
    expect(normalizeImageModelId('unknown-model')).toBe('unknown-model');
    expect(normalizeImageModelId(undefined)).toBeUndefined();
    expect(normalizeImageModelId('toString')).toBe('toString');
    expect(imageModelFingerprintId('gpt-image-2.5-sunburst')).toBe('gpt-image-2.5-sunburst');
    expect(imageModelFingerprintId(undefined)).toBeUndefined();
  });

  it('keeps the legacy Gemini image fallback independent of the default', () => {
    expect(LEGACY_FALLBACK_GEMINI_IMAGE_MODEL).toBe('gemini-3.1-flash-image-preview');
  });

  it('rejects dated snapshots and unknown GPT Image ids', () => {
    expect(isImageModel('gpt-image-2.5-sunburst-2026-09-08')).toBe(false);
    expect(isOpenAIImageModel('gpt-image-2.5-flare-2026-09-08')).toBe(false);
    expect(isOpenAIImageModel('gpt-image-2.5')).toBe(false);
    expect(isOpenAIImageModel(undefined)).toBe(false);
  });
});

describe('default text models and selectable model lists', () => {
  it('uses Claude Opus 5.5 for new script and image prompt settings', () => {
    expect(DEFAULT_SCRIPT_TEXT_MODEL).toBe('claude-opus-5-5');
    expect(DEFAULT_IMAGE_PROMPT_TEXT_MODEL).toBe('claude-opus-5-5');
    // model が記録されていない過去の OpenAI レコード用の代替値は旧来のまま
    expect(OPENAI_TEXT_COMPLETION_MODEL).toBe('gpt-5.2');
  });

  it('removes legacy text models from the selector but keeps them valid', () => {
    expect(LEGACY_TEXT_COMPLETION_MODELS).toEqual(['gpt-5.5', 'gpt-5.4', 'gpt-5.2']);
    expect(SELECTABLE_TEXT_COMPLETION_MODELS).toEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gemini-3.1-pro',
      'claude-opus-5-5',
    ]);
    for (const model of LEGACY_TEXT_COMPLETION_MODELS) {
      expect(isTextCompletionModel(model)).toBe(true);
      expect(TEXT_COMPLETION_MODELS).toContain(model);
    }
  });

  it('offers only the Gemini 3.8 TTS models and keeps older TTS ids valid', () => {
    expect(SELECTABLE_GEMINI_TTS_MODELS).toEqual([
      'gemini-3.8-flash-tts',
      'gemini-3.8-flash-lite-tts',
    ]);
    for (const model of LEGACY_GEMINI_TTS_MODELS) {
      expect(isGeminiTtsModel(model)).toBe(true);
      expect(SELECTABLE_GEMINI_TTS_MODELS).not.toContain(model);
    }
  });

  it('removes GPT Image 2 from the selector but keeps it valid', () => {
    expect(LEGACY_IMAGE_MODELS).toEqual(['gpt-image-2']);
    expect(SELECTABLE_IMAGE_MODELS).not.toContain('gpt-image-2');
    expect(SELECTABLE_IMAGE_MODELS).toEqual(
      IMAGE_MODELS.filter((model) => model !== 'gpt-image-2')
    );
    expect(isImageModel('gpt-image-2')).toBe(true);
  });

  it('allows explicit OpenAI prompt cache breakpoints only on gpt-5.6 and later', () => {
    for (const model of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const) {
      expect(supportsOpenAIPromptCacheBreakpoint(model)).toBe(true);
    }
    for (const model of ['gpt-5.5', 'gpt-5.4', 'gpt-5.2'] as const) {
      expect(supportsOpenAIPromptCacheBreakpoint(model)).toBe(false);
    }
  });
});
