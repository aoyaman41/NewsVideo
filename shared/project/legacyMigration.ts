import { isImageStylePreset, type ImageStylePreset } from './imageStylePresets';

/**
 * 廃止済みの画像スタイルの値 → 現行の値。
 * 2026-03 の c3bf32f で画像スタイルを infographic に固定したとき、これらの旧値はすべて
 * `STYLE_PRESET_ALIASES` で infographic の別名として扱われていた。その後 f68fe46 で
 * スタイルを選べるようになった際に別名の表が削除され、旧値を持つ v1.1 のプロジェクトが
 * 検証で失敗するようになった。当時と同じ読み替えを読み込み時に行う。
 */
export const LEGACY_IMAGE_STYLE_PRESET_ALIASES: Readonly<Record<string, ImageStylePreset>> = {
  news_broadcast: 'infographic',
  news_panel: 'infographic',
  documentary: 'infographic',
  photorealistic: 'infographic',
  illustration: 'infographic',
};

function migrateStylePreset(value: unknown): unknown {
  if (typeof value !== 'string' || isImageStylePreset(value)) return value;
  return Object.prototype.hasOwnProperty.call(LEGACY_IMAGE_STYLE_PRESET_ALIASES, value)
    ? LEGACY_IMAGE_STYLE_PRESET_ALIASES[value]
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 保存データを検証する前に、旧形式の値を現行の値へ読み替える。
 * 入力は変更せず、読み替えが必要なときだけ新しいオブジェクトを返す。
 * 保存は行わない(次に保存したときに現行の値で書き込まれる)。
 */
export function migrateLegacyProjectData<T>(data: T): T {
  if (!isRecord(data)) return data;
  let result: Record<string, unknown> = data;
  if (Array.isArray(data.prompts)) {
    let changed = false;
    const prompts = data.prompts.map((prompt) => {
      if (!isRecord(prompt)) return prompt;
      const stylePreset = migrateStylePreset(prompt.stylePreset);
      if (stylePreset === prompt.stylePreset) return prompt;
      changed = true;
      return { ...prompt, stylePreset };
    });
    if (changed) result = { ...result, prompts };
  }
  if (isRecord(data.presentationProfile)) {
    const imageStylePreset = migrateStylePreset(data.presentationProfile.imageStylePreset);
    if (imageStylePreset !== data.presentationProfile.imageStylePreset)
      result = {
        ...result,
        presentationProfile: { ...data.presentationProfile, imageStylePreset },
      };
  }
  return result as T;
}
