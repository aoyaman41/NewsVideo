/**
 * 画像に描く文字のルールをここに集約する。
 *
 * - 画像プロンプトでは、描く文字列を「画面に描く文字」欄に「」で囲んで列挙する(formatImageTextSection)
 * - 画像生成時のシステム指示で「この文字列以外は描かない」を 1 回だけ伝える(IMAGE_TEXT_RULE)
 *
 * 公式の推奨(描く文言を引用符で正確に指定し、それ以外の文字は描かせない)に合わせた形。
 */
export const IMAGE_TEXT_SECTION_LABEL = '画面に描く文字';

export const IMAGE_TEXT_RULE = `画面に描く文字は、「${IMAGE_TEXT_SECTION_LABEL}」欄に「」で囲んで並べた文字列だけにする。表記を変えずに正確に描き、この文字列以外は描かない。`;

/**
 * 「画面に描く文字」欄を持たないプロンプト(旧形式の図解プロンプトや、ユーザーが自由に書いたプロンプト)用。
 * IMAGE_TEXT_RULE をそのまま使うと文字がまったく描かれなくなるため、従来に近い緩いルールにする。
 */
export const IMAGE_TEXT_RULE_WITHOUT_SECTION =
  '画面に描く文字は、「指示」の内容に沿った短い見出し・ラベル・数値だけにする。構図や配置の説明は文字として描かない。';

export type ImageTextItem = {
  label: string;
  text: string | undefined;
};

// 全体が 1 組の「」で囲まれている場合だけ外す(二重に囲まないため)
function unwrapQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.startsWith('「') &&
    trimmed.endsWith('」') &&
    trimmed.indexOf('「', 1) === -1 &&
    trimmed.indexOf('」') === trimmed.length - 1
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** 「画面に描く文字」欄の行を作る。空の項目は除き、項目がなければ空配列を返す */
export function formatImageTextSection(items: ImageTextItem[]): string[] {
  const lines = items
    .map((item) => ({ label: item.label.trim(), text: unwrapQuotes(item.text ?? '') }))
    .filter((item) => item.text.length > 0)
    .map((item) => `- ${item.label}:「${item.text}」`);
  return lines.length > 0 ? [`${IMAGE_TEXT_SECTION_LABEL}:`, ...lines] : [];
}

const TEXT_SECTION_HEADER_PATTERN = new RegExp(`^${IMAGE_TEXT_SECTION_LABEL}\\s*[:：]\\s*$`);
const LEGACY_TEXT_SECTION_HEADER_PATTERN = /^(?:画面コピー|画面テキスト)\s*[:：]\s*$/;
const BULLET_PATTERN = /^-\s*([^:：]*?)\s*[:：]\s*(.*)$/;

/** プロンプトに「画面に描く文字」欄があるか(旧形式の欄は upgradeLegacyImageTextSection で読み替えた後に判定する) */
export function hasImageTextSection(prompt: string): boolean {
  return prompt.split(/\r?\n/).some((line) => TEXT_SECTION_HEADER_PATTERN.test(line.trim()));
}

/** 画像生成時のシステム指示に入れる文字のルール。欄がないプロンプトには緩いルールを使う */
export function getImageTextRule(prompt: string): string {
  return hasImageTextSection(prompt) ? IMAGE_TEXT_RULE : IMAGE_TEXT_RULE_WITHOUT_SECTION;
}

/**
 * 保存済みの旧形式のプロンプト(「画面コピー」「画面テキスト」欄に「- 見出し: 文言」と並べる形)を、
 * 画像生成の直前に「画面に描く文字」欄の形へ読み替える。新形式のプロンプトはそのまま返す。
 */
export function upgradeLegacyImageTextSection(prompt: string): string {
  const lines = prompt.split(/\r?\n/);
  if (hasImageTextSection(prompt)) return prompt;
  if (!lines.some((line) => LEGACY_TEXT_SECTION_HEADER_PATTERN.test(line.trim()))) return prompt;

  const upgraded: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (LEGACY_TEXT_SECTION_HEADER_PATTERN.test(trimmed)) {
      inSection = true;
      upgraded.push(`${IMAGE_TEXT_SECTION_LABEL}:`);
      continue;
    }
    if (inSection && trimmed.startsWith('-')) {
      const match = trimmed.match(BULLET_PATTERN);
      const label = match?.[1]?.trim() ?? '';
      const text = unwrapQuotes(match ? match[2] : trimmed.slice(1));
      // 旧形式の空欄(「- 4:」など)は描く文字がないので落とす
      if (!text) continue;
      upgraded.push(label ? `- ${label}:「${text}」` : `-「${text}」`);
      continue;
    }
    inSection = false;
    upgraded.push(line);
  }
  return upgraded.join('\n');
}
