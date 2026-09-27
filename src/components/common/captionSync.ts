import type { Part, Project } from '../../schemas';
import { estimateCaptions, type Caption } from '../../../shared/project/captions';
import { splitScriptIntoSegments } from '../../../shared/utils/ttsSegmentation';

// 字幕は動画画面の ON/OFF だけで扱う。字幕がないシーンは台本と音声から作り、
// 文面が台本と同じ字幕は時刻だけを最新にする(手で直した時刻は残す)。
// 文面が台本と違う字幕(以前の版で手で直した字幕、または台本を後から変えたシーン)は
// 勝手に作り直さず、画面で「字幕を台本に合わせる」を選んだときだけ作り直す。

const compact = (text: string) => text.replace(/\s+/g, '');

/** 字幕の文面が今の台本と同じか */
export function captionsMatchScript(captions: Caption[], part: Part): boolean {
  return (
    compact(captions.map((cue) => cue.text).join('')) ===
    compact(splitScriptIntoSegments(part.scriptText).join(''))
  );
}

function sameCues(a: Caption[], b: Caption[]): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.005;
  return (
    a.length === b.length &&
    a.every(
      (cue, i) =>
        cue.text === b[i].text &&
        cue.timing === b[i].timing &&
        near(cue.start, b[i].start) &&
        near(cue.end, b[i].end)
    )
  );
}

/** このシーンで使う字幕。変える必要がなければ今の配列をそのまま返す */
export function freshCaptions(part: Part): Caption[] {
  const current = part.captions ?? [];
  if (current.length === 0) {
    return part.scriptText.trim() ? estimateCaptions(part) : current;
  }
  // 文面が台本と違う字幕は作り直さない(手で直した文面を消さないため)
  if (!captionsMatchScript(current, part)) return current;
  // 手で直した時刻は残す
  if (current.some((cue) => cue.timing === 'manual')) return current;
  // 自動で付けた時刻は、音声に合わせて最新にする
  const next = estimateCaptions(part);
  return sameCues(current, next) ? current : next;
}

/** すべてのシーンの字幕を ON/OFF する。ON のときは字幕がないシーンの字幕を作る */
export function setCaptionsEnabled(project: Project, enabled: boolean): Project {
  return {
    ...project,
    parts: project.parts.map((part) =>
      enabled
        ? { ...part, captionsEnabled: true, captions: freshCaptions(part) }
        : { ...part, captionsEnabled: false }
    ),
  };
}

/**
 * 字幕が ON のシーンについて、字幕がなければ作り、自動で付けた時刻を最新にする。
 * 変更がなければ null を返す(保存し直さないため)。
 */
export function refreshEnabledCaptions(project: Project): Project | null {
  let changed = false;
  const parts = project.parts.map((part) => {
    if (!part.captionsEnabled) return part;
    const captions = freshCaptions(part);
    if (captions === part.captions || (captions.length === 0 && !part.captions)) return part;
    changed = true;
    return { ...part, captions };
  });
  return changed ? { ...project, parts } : null;
}

/** 字幕が ON で、字幕の文面が台本と違うシーン */
export function captionMismatchParts(project: Project): Part[] {
  return project.parts.filter(
    (part) =>
      part.captionsEnabled &&
      (part.captions?.length ?? 0) > 0 &&
      part.scriptText.trim() &&
      !captionsMatchScript(part.captions ?? [], part)
  );
}

/** 指定したシーンの字幕を、今の台本と音声から作り直す */
export function alignCaptionsToScript(project: Project, partIds: string[]): Project {
  const targets = new Set(partIds);
  return {
    ...project,
    parts: project.parts.map((part) =>
      targets.has(part.id) ? { ...part, captions: estimateCaptions(part) } : part
    ),
  };
}

/** 動画全体の字幕の状態 */
export function captionState(project: Project): 'on' | 'off' | 'mixed' {
  const enabled = project.parts.filter((part) => part.captionsEnabled).length;
  if (enabled === 0) return 'off';
  return enabled === project.parts.length ? 'on' : 'mixed';
}
