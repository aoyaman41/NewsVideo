const STYLE_LINE_PATTERN = /^(視覚トーン|配色|色調|トーン|スタイル|質感)\s*[:：]/;
const LAYOUT_FIELD_PATTERN = /^(レイアウト方針|レイアウト|視線誘導)\s*[:：]\s*(.*)$/;
const PLACEMENT_SECTION_PATTERN = /^配置\s*[:：]?\s*$/;
const NON_PLACEMENT_SECTION_PATTERN = /^(情報の優先順位|要素|画面テキスト)\s*[:：]?\s*$/;
const SOURCE_LINE_PATTERN =
  /^-?\s*(?:\d+\s*[:：]\s*)?(?:出典表示|出典|sourceLine|source_line|source)\s*[:：]/iu;
const SOURCE_OBJECT_PATTERN = /^-\s*\d+\s*[:：]\s*source\s*\//iu;
const PERCENT_PATTERN = /\d{1,3}%/g;
const SIZE_TOKEN_PATTERN = /([:：]\s*)(?:\d{1,3}%|大|中|小|主|従|補助|広め|細め)\s*\/\s*/u;

function collapseLineWhitespace(value: string): string {
  return value
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*→\s*/g, ' → ')
    .replace(/\s+([、。,:：])/g, '$1')
    .replace(/([:：])\s+([^\s])/g, '$1 $2')
    .trim();
}

function sanitizeLayoutFieldLine(line: string): string {
  const match = line.match(LAYOUT_FIELD_PATTERN);
  if (!match) return collapseLineWhitespace(line);

  const [, label, rawContent] = match;
  const content = collapseLineWhitespace(rawContent.replace(PERCENT_PATTERN, ''));
  return content ? `${label}: ${content}` : `${label}:`;
}

function sanitizePlacementLine(line: string): string {
  const withoutSizeLabel = line.replace(/\((?:サイズ感?|サイズ)\/内容\)/g, '');
  const withoutLeadingSize = withoutSizeLabel.replace(SIZE_TOKEN_PATTERN, '$1');
  const withoutPercents = withoutLeadingSize.replace(PERCENT_PATTERN, '');

  return collapseLineWhitespace(withoutPercents)
    .replace(/([:：])\s*\/\s*/g, '$1 ')
    .replace(/([:：])\s*$/g, '$1');
}

export function sanitizeImagePromptForRendering(text: string): string {
  if (!text) return '';

  const lines = text.split(/\r?\n/);
  const sanitized: string[] = [];
  let inPlacementSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (sanitized[sanitized.length - 1] !== '') {
        sanitized.push('');
      }
      continue;
    }

    if (STYLE_LINE_PATTERN.test(trimmed)) {
      continue;
    }

    if (SOURCE_LINE_PATTERN.test(trimmed) || SOURCE_OBJECT_PATTERN.test(trimmed)) {
      continue;
    }

    if (PLACEMENT_SECTION_PATTERN.test(trimmed)) {
      inPlacementSection = true;
      sanitized.push('配置:');
      continue;
    }

    if (NON_PLACEMENT_SECTION_PATTERN.test(trimmed)) {
      inPlacementSection = false;
      sanitized.push(trimmed.replace(/\s*[:：]?\s*$/, ':'));
      continue;
    }

    if (LAYOUT_FIELD_PATTERN.test(trimmed)) {
      inPlacementSection = false;
      sanitized.push(sanitizeLayoutFieldLine(trimmed));
      continue;
    }

    if (/^[^-][^:：]*[:：]/.test(trimmed)) {
      inPlacementSection = false;
      sanitized.push(collapseLineWhitespace(trimmed));
      continue;
    }

    if (inPlacementSection && trimmed.startsWith('-')) {
      sanitized.push(sanitizePlacementLine(trimmed));
      continue;
    }

    sanitized.push(collapseLineWhitespace(trimmed));
  }

  return sanitized.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
