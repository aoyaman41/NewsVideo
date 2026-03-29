export type ContentCustomizationCategory =
  | 'preset_only'
  | 'preset_with_override'
  | 'advanced_only'
  | 'direct_setting';

export type ContentCustomizationUiExposure = 'main' | 'details' | 'advanced';

export interface ContentCustomizationBoundary {
  id: string;
  label: string;
  category: ContentCustomizationCategory;
  uiExposure: ContentCustomizationUiExposure;
  description: string;
}

export const CONTENT_CUSTOMIZATION_BOUNDARIES: readonly ContentCustomizationBoundary[] = [
  {
    id: 'image_style',
    label: '画像スタイル',
    category: 'preset_only',
    uiExposure: 'details',
    description: '画像の表現方向は preset で揃え、自由入力の style prompt は通常 UI に出さない。',
  },
  {
    id: 'tts_narration_style',
    label: 'TTS 話法',
    category: 'preset_with_override',
    uiExposure: 'main',
    description: 'ナレーション話法は preset で選び、短い補足だけ上書きできる。',
  },
  {
    id: 'layout_direction',
    label: 'レイアウト方針',
    category: 'preset_only',
    uiExposure: 'details',
    description: '動画全体の見せ方は preset で揃え、任意テンプレート指定は advanced に閉じる。',
  },
  {
    id: 'closing_line',
    label: '締め文',
    category: 'preset_with_override',
    uiExposure: 'main',
    description: '既定の締め文を持ちつつ、なしやカスタム文言で上書きできる。',
  },
  {
    id: 'call_to_action',
    label: 'CTA',
    category: 'preset_with_override',
    uiExposure: 'details',
    description: '導線文言は preset を基本とし、案件ごとの差し替えだけ許容する。',
  },
  {
    id: 'opening_line',
    label: '冒頭文',
    category: 'preset_with_override',
    uiExposure: 'details',
    description: '冒頭の一言は preset を基本にしつつ、必要時だけ差し替える。',
  },
  {
    id: 'brand_name',
    label: 'ブランド名',
    category: 'preset_with_override',
    uiExposure: 'details',
    description: 'ブランド名や番組名は preset に乗せつつ、文言だけ上書き可能にする。',
  },
  {
    id: 'source_display_policy',
    label: '出典表示方針',
    category: 'preset_with_override',
    uiExposure: 'details',
    description: '出典の出し方は preset を基本にし、表示文言や表示有無だけ上書き可能にする。',
  },
  {
    id: 'image_prompt_suffix',
    label: '画像 prompt 上書き',
    category: 'advanced_only',
    uiExposure: 'advanced',
    description: '自由入力の image prompt suffix や negative prompt は advanced のみで扱う。',
  },
  {
    id: 'tts_prompt_guidance',
    label: 'TTS prompt 上書き',
    category: 'advanced_only',
    uiExposure: 'advanced',
    description: 'TTS 向けの自由入力 prompt は品質崩れを起こしやすいため advanced に限定する。',
  },
  {
    id: 'layout_template',
    label: 'レイアウトテンプレート',
    category: 'advanced_only',
    uiExposure: 'advanced',
    description: 'テンプレート ID や詳細レイアウト指定は advanced 設定に閉じる。',
  },
  {
    id: 'brand_rendering_rules',
    label: 'ブランド描画ルール',
    category: 'advanced_only',
    uiExposure: 'advanced',
    description: 'ロゴや表記ルールなどの詳細指定は advanced でのみ編集可能にする。',
  },
  {
    id: 'target_part_count',
    label: 'パート数',
    category: 'direct_setting',
    uiExposure: 'main',
    description: '生成構成に直接効く値なので preset ではなく通常設定として扱う。',
  },
  {
    id: 'target_duration_per_part_sec',
    label: '1パートの目安秒数',
    category: 'direct_setting',
    uiExposure: 'main',
    description: '生成密度に直接効く値なので通常設定として扱う。',
  },
  {
    id: 'aspect_ratio',
    label: 'アスペクト比',
    category: 'direct_setting',
    uiExposure: 'details',
    description: '出力媒体に直接依存するため、preset とは別の通常設定として扱う。',
  },
  {
    id: 'resolution',
    label: '解像度',
    category: 'direct_setting',
    uiExposure: 'details',
    description: '品質とコストに直接効くため、preset ではなく通常設定として扱う。',
  },
  {
    id: 'voice',
    label: '音声ボイス',
    category: 'direct_setting',
    uiExposure: 'details',
    description: 'スタイル preset とは別に、生成対象ごとに素直に選べる設定として扱う。',
  },
  {
    id: 'opening_ending_media',
    label: 'オープニング / エンディング素材',
    category: 'direct_setting',
    uiExposure: 'details',
    description: '素材の有無や差し込み自体は通常設定として扱う。',
  },
] as const;

export function getContentCustomizationBoundariesByCategory(
  category: ContentCustomizationCategory
): ContentCustomizationBoundary[] {
  return CONTENT_CUSTOMIZATION_BOUNDARIES.filter((boundary) => boundary.category === category);
}
