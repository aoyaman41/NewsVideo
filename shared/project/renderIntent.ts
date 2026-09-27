import { inputFingerprint } from './integrity';
import { normalizePresentationProfile, resolvePresentationSourceLine } from './presentationProfile';
import type { Part, Project } from './schema';

/**
 * 書き出し・プレビューの競合エラーの目印。画面側はこれを見て、再読込と 1 回だけの再試行を判断する。
 * エラー文は自動生成ジョブの分類(classifyGenerationError)で「競合」になるよう「変更されました」を含める。
 */
export const RENDER_CONFLICT_MARKER = '[RENDER_CONFLICT]';

export function renderConflictMessage(kind: 'render' | 'preview'): string {
  const action = kind === 'render' ? '書き出し' : 'プレビュー';
  return `${RENDER_CONFLICT_MARKER} ${action}の順番を待つ間に、動画の内容(シーンの構成・画像・音声・字幕・締めカード)が変更されました。最新の内容を確認してから、もう一度${action}してください。`;
}

export function isRenderConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(RENDER_CONFLICT_MARKER);
}

/** 画面に表示するときは目印を取り除く */
export function stripRenderConflictMarker(message: string): string {
  return message.replace(`${RENDER_CONFLICT_MARKER} `, '').replace(RENDER_CONFLICT_MARKER, '');
}

function partRenderInput(project: Project, part: Part) {
  const assets = new Map(
    [...project.images, ...project.article.importedImages].map((asset) => [
      asset.id,
      asset.filePath,
    ])
  );
  return {
    id: part.id,
    index: part.index,
    images: part.panelImages.map((ref) => ({
      id: ref.imageId,
      file: assets.get(ref.imageId) ?? null,
      durationSec: ref.displayDurationSec ?? null,
    })),
    audio: part.audio
      ? { id: part.audio.id, file: part.audio.filePath, durationSec: part.audio.durationSec }
      : null,
    captions: part.captionsEnabled ? (part.captions ?? []) : null,
    graphic: part.graphic ?? null,
  };
}

/**
 * 書き出す動画の内容を決める入力の指紋。
 * リビジョン・メトリクス・出力設定の保存・ジョブの状態・使用量など、書き出し結果に影響しない
 * 項目は含めない(出力設定は呼び出し側が明示的に渡すので、保存済みの値とは比べない)。
 * 台本などの素材の鮮度は、書き出し時に最新のプロジェクトに対して別に確認する。
 */
export function renderContentFingerprint(project: Project): string {
  const profile = normalizePresentationProfile(project.presentationProfile);
  return inputFingerprint({
    parts: [...project.parts]
      .sort((a, b) => a.index - b.index)
      .map((part) => partRenderInput(project, part)),
    aspectRatio: profile.aspectRatio,
    closingCard: profile.closingCardEnabled
      ? {
          headline: profile.closingCardHeadline,
          cta: profile.closingCardCtaText,
          source: resolvePresentationSourceLine(profile, project.article.source) ?? null,
        }
      : null,
  });
}

/**
 * 1 パートのプレビューの内容を決める入力の指紋。パートがなければ null。
 * プレビューは保存済みの出力設定(解像度・fps・読み上げ開始の間)を使うので、それも含める。
 */
export function partRenderFingerprint(project: Project, partId: string): string | null {
  const part = project.parts.find((item) => item.id === partId);
  if (!part) return null;
  return inputFingerprint({
    part: partRenderInput(project, part),
    aspectRatio: normalizePresentationProfile(project.presentationProfile).aspectRatio,
    output: {
      resolution: project.outputSettings?.resolution ?? null,
      fps: project.outputSettings?.fps ?? null,
      leadInSec: project.outputSettings?.videoPartLeadInSec ?? null,
    },
  });
}
