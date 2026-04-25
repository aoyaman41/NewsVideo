export const IMAGE_STYLE_PRESETS = [
  'infographic',
  'editorial',
  'minimal',
  'social',
  'textRich',
  'dataCard',
] as const;
export type ImageStylePreset = (typeof IMAGE_STYLE_PRESETS)[number];

export const IMAGE_ASPECT_RATIOS = ['16:9', '1:1', '9:16'] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const DEFAULT_IMAGE_STYLE_PRESET: ImageStylePreset = 'infographic';
export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = '16:9';

export const IMAGE_STYLE_PRESET_LABELS: Record<ImageStylePreset, string> = {
  infographic: '図解',
  editorial: 'エディトリアル',
  minimal: 'ミニマル',
  social: 'SNS カード',
  textRich: '文字入りスライド',
  dataCard: 'データカード',
};

export const IMAGE_STYLE_PRESET_DESCRIPTIONS: Record<ImageStylePreset, string> = {
  infographic: '数値や補助情報を整理しやすい図解寄りの既定値',
  editorial: '誌面や特集記事のような落ち着いたビジュアル寄り',
  minimal: '余白を広く取り、要点だけを静かに見せる',
  social: '短尺動画やSNS向けにアクセントを強めた見せ方',
  textRich: '見出し・要点・数値を画像内に組み込む新モデル向けスライド',
  dataCard: '数値、比較、時系列を大きく見せる高密度な説明カード',
};

export const IMAGE_ASPECT_RATIO_LABELS: Record<ImageAspectRatio, string> = {
  '16:9': '16:9 (横長)',
  '1:1': '1:1 (正方形)',
  '9:16': '9:16 (縦長)',
};

export type ImageStylePresetConfig = {
  id: ImageStylePreset;
  baseStyle: string;
  colorPalette: string;
  lighting: string;
  background: string;
  density: 'low' | 'medium' | 'high';
  negative: string;
};

export const IMAGE_STYLE_PRESET_CONFIGS: Record<ImageStylePreset, ImageStylePresetConfig> = {
  infographic: {
    id: 'infographic',
    baseStyle: 'フラットなベクター調、非写実、情報整理しやすい明瞭な図解表現',
    colorPalette:
      '背景 #F6F7F9、主要線 #1F3552、補助線 #5C6B7A、アクセント #2C8E8A（単色）、文字 #0F172A',
    lighting: 'フラットでマットな質感',
    background: '余白を十分に取った明るい無地背景',
    density: 'low',
    negative:
      '人物, 顔, 手, 群衆, 肖像, インタビュー, アナウンサー, 記者, 番組セット, テロップ, 速報帯, ティッカー, ニュース名, 番組名, 局名, 番組タイトル, カテゴリー名, ロゴ, 透かし, QRコード, 商標, 写真, 実写, 写真風, 写実, フォトリアル, フォトリアリスティック, カメラ風, 過度なネオン, 強コントラスト, ギラついた光沢, サイバーパンク, アニメ調',
  },
  editorial: {
    id: 'editorial',
    baseStyle:
      '誌面レイアウトを思わせる整理されたエディトリアルイラスト、非写実、落ち着いた情報ビジュアル',
    colorPalette: '背景 #F4F1EC、主要線 #243447、補助線 #6B7280、アクセント #A85530、文字 #111827',
    lighting: 'やわらかい自然光、紙面のような落ち着いたコントラスト',
    background: '淡い紙面調の背景と控えめな余白',
    density: 'medium',
    negative:
      '実在人物, 顔写真, 実写, フォトリアル, スタジオ照明, 派手なネオン, テレビ番組ロゴ, 局名, 透かし, QRコード, 過度な立体表現, アニメ調',
  },
  minimal: {
    id: 'minimal',
    baseStyle: '余白を広く取ったミニマルなフラットデザイン、静かな配色、単純化した図形表現',
    colorPalette: '背景 #FAFAF9、主要線 #0F172A、補助線 #94A3B8、アクセント #2563EB、文字 #0F172A',
    lighting: 'フラット、陰影を抑えたクリーンな質感',
    background: '無地で静かな背景、装飾最小限',
    density: 'low',
    negative:
      '人物, 写真, 実写, フォトリアル, 過密な図表, 強い発光, テレビ番組らしい装飾, ティッカー, ロゴ, 透かし, アニメ調',
  },
  social: {
    id: 'social',
    baseStyle: 'SNS カード向けの鮮明なベクターイラスト、強めのアクセント、短時間で理解できる構図',
    colorPalette: '背景 #FFF7ED、主要線 #7C2D12、補助線 #9A3412、アクセント #EA580C、文字 #431407',
    lighting: '明るくクリア、コントラストは高めだが写実に寄せない',
    background: '単純化した色面背景と大きめのアクセント形状',
    density: 'medium',
    negative:
      '実在人物, 顔写真, 実写, フォトリアル, 長文テキスト, テレビ番組ロゴ, 局名, 透かし, QRコード, 写真風, 過剰な3D, サイバーパンク',
  },
  textRich: {
    id: 'textRich',
    baseStyle:
      '完成されたニュース解説スライド、読みやすい日本語タイポグラフィ、図形とテキストを一体化した情報デザイン',
    colorPalette:
      '背景 #F8FAFC、主要文字 #0F172A、補助文字 #475569、アクセント #0E7490 と #EAB308、区切り線 #CBD5E1',
    lighting: 'フラットで印刷物のように均一、文字のコントラストを最優先',
    background: '淡い無地または控えめな面分割背景、本文領域の余白を明確に確保',
    density: 'high',
    negative:
      '実在人物, 顔写真, 実写, フォトリアル, テレビ番組ロゴ, 局名, 透かし, QRコード, 読めない文字, 文字化け, 架空の追加数値, 過度な装飾, サイバーパンク',
  },
  dataCard: {
    id: 'dataCard',
    baseStyle:
      'データカード型のニュース図解、数値と短い分析コメントを大きく扱う、整然としたダッシュボード風レイアウト',
    colorPalette:
      '背景 #F9FAFB、主要文字 #111827、補助文字 #4B5563、増加色 #047857、減少色 #B91C1C、アクセント #2563EB',
    lighting: 'フラットでマット、グラフと数字の視認性を優先',
    background: '白から薄いグレーの整理されたカード背景、罫線と余白で情報を区分',
    density: 'high',
    negative:
      '実在人物, 顔写真, 実写, フォトリアル, テレビ番組ロゴ, 局名, 透かし, QRコード, 読めない文字, 文字化け, 出典にない数値, 派手な3D, 過度なネオン',
  },
};

type LayoutVariantKey = 'dataAndLocation' | 'dataOnly' | 'locationOnly' | 'general';

const LAYOUT_VARIANTS_BY_ASPECT_RATIO: Record<
  ImageAspectRatio,
  Record<LayoutVariantKey, string>
> = {
  '16:9': {
    dataAndLocation:
      '横長レイアウト。左に主ビジュアルを大きく置き、右を上下2段に分けて上に地図、下に図表を置く',
    dataOnly: '横長レイアウト。左に主ビジュアルを大きく置き、右に図表パネルをまとめる',
    locationOnly: '横長レイアウト。左に主ビジュアルを大きく置き、右に地図パネルを置く',
    general: '横長レイアウト。左に主ビジュアルを大きく置き、右に補助情報パネルを置く',
  },
  '1:1': {
    dataAndLocation: '正方形レイアウト。中央上に主ビジュアル、下段を左右に分けて地図と図表を並べる',
    dataOnly: '正方形レイアウト。中央上に主ビジュアル、下段に図表パネルを横並びで置く',
    locationOnly: '正方形レイアウト。中央上に主ビジュアル、下段に地図パネルを置く',
    general: '正方形レイアウト。中央上に主ビジュアル、下段に補助情報パネルを置く',
  },
  '9:16': {
    dataAndLocation: '縦長レイアウト。上段に主ビジュアル、中段に地図、下段に図表を積み重ねる',
    dataOnly: '縦長レイアウト。上段に主ビジュアル、下段に図表パネルを積み重ねる',
    locationOnly: '縦長レイアウト。上段に主ビジュアル、下段に地図パネルを置く',
    general: '縦長レイアウト。上段に主ビジュアル、下段に補助情報パネルを置く',
  },
};

export function isImageStylePreset(value: unknown): value is ImageStylePreset {
  return typeof value === 'string' && IMAGE_STYLE_PRESETS.includes(value as ImageStylePreset);
}

export function isImageAspectRatio(value: unknown): value is ImageAspectRatio {
  return typeof value === 'string' && IMAGE_ASPECT_RATIOS.includes(value as ImageAspectRatio);
}

export function getImageStylePresetConfig(preset: unknown): ImageStylePresetConfig {
  return IMAGE_STYLE_PRESET_CONFIGS[
    isImageStylePreset(preset) ? preset : DEFAULT_IMAGE_STYLE_PRESET
  ];
}

export function getImageAspectRatioLabel(aspectRatio: ImageAspectRatio): string {
  return IMAGE_ASPECT_RATIO_LABELS[aspectRatio];
}

export function getImageLayoutVariant(
  aspectRatio: ImageAspectRatio,
  hasData: boolean,
  hasLocation: boolean
): string {
  const variants = LAYOUT_VARIANTS_BY_ASPECT_RATIO[aspectRatio];
  if (hasData && hasLocation) return variants.dataAndLocation;
  if (hasData) return variants.dataOnly;
  if (hasLocation) return variants.locationOnly;
  return variants.general;
}
