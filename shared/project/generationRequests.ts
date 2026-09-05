import { z } from 'zod';
import { articleSchema, imagePromptSchema, scriptOptionsSchema } from './schema';
import { GEMINI_TTS_MODELS } from '../constants/models';
import { TTS_NARRATION_STYLE_PRESETS } from './ttsNarrationStyles';
export const scriptRequestSchema = z.object({
  article: articleSchema,
  options: scriptOptionsSchema,
});
// Legacy prompt IDs are supported; IDs never authorize filesystem access.
export const imageRequestSchema = imagePromptSchema.extend({
  id: z.string().min(1).max(200),
  partId: z.string().min(1).max(200),
  prompt: z.string().min(1).max(50000),
});
export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(50000),
  options: z.object({
    ttsEngine: z.enum(['google_tts', 'gemini_tts', 'macos_tts']),
    ttsModel: z.enum(GEMINI_TTS_MODELS).optional(),
    voiceName: z.string().min(1).max(200),
    languageCode: z.string().min(1).max(30),
    speakingRate: z.number().min(0.5).max(2),
    pitch: z.number().min(-20).max(20),
    audioEncoding: z.enum(['MP3', 'LINEAR16']),
    narrationStylePreset: z.enum(TTS_NARRATION_STYLE_PRESETS).optional(),
    narrationStyleNote: z.string().max(10000).optional(),
  }),
});
