import { describe, expect, it } from 'vitest';
import { createNewPart, type Part, type Project } from '../../schemas';
import {
  alignCaptionsToScript,
  captionMismatchParts,
  captionState,
  freshCaptions,
  refreshEnabledCaptions,
  setCaptionsEnabled,
} from './captionSync';

function project(parts: Part[]): Project {
  return { parts } as unknown as Project;
}

const scene = (scriptText: string, extra: Partial<Part> = {}) =>
  ({ ...createNewPart(0, { scriptText, durationEstimateSec: 10 }), ...extra }) as Part;

describe('captionSync', () => {
  it('ON にすると、字幕がないシーンの字幕を台本から作る', () => {
    const result = setCaptionsEnabled(
      project([scene('最初の文。次の文。'), scene('三つ目。')]),
      true
    );
    expect(result.parts.every((part) => part.captionsEnabled)).toBe(true);
    expect(result.parts[0].captions?.map((cue) => cue.text)).toEqual(['最初の文。', '次の文。']);
    expect(captionState(result)).toBe('on');
  });

  it('OFF にしても字幕のデータは消さない', () => {
    const on = setCaptionsEnabled(project([scene('最初の文。')]), true);
    const off = setCaptionsEnabled(on, false);
    expect(off.parts[0].captionsEnabled).toBe(false);
    expect(off.parts[0].captions).toHaveLength(1);
    expect(captionState(off)).toBe('off');
  });

  it('台本も音声も変わっていなければ、字幕を作り直さない', () => {
    const on = setCaptionsEnabled(project([scene('最初の文。次の文。')]), true);
    expect(refreshEnabledCaptions(on)).toBeNull();
  });

  it('文面が台本と同じなら、自動で付けた時刻だけを音声の長さに合わせる', () => {
    const on = setCaptionsEnabled(project([scene('最初の文。次の文。')]), true);
    const withAudio = project([{ ...on.parts[0], durationEstimateSec: 20 }]);
    const refreshed = refreshEnabledCaptions(withAudio);
    expect(refreshed?.parts[0].captions?.at(-1)?.end).toBeCloseTo(20);
  });

  it('文面が台本と違う字幕(手で直した字幕など)は勝手に作り直さず、ずれとして示す', () => {
    const on = setCaptionsEnabled(project([scene('最初の文。次の文。')]), true);
    const edited = project([
      {
        ...on.parts[0],
        captions: on.parts[0].captions!.map((cue, i) =>
          i === 0 ? { ...cue, text: '最初の文(手直し)。' } : cue
        ),
      },
    ]);
    expect(refreshEnabledCaptions(edited)).toBeNull();
    expect(captionMismatchParts(edited)).toHaveLength(1);

    const aligned = alignCaptionsToScript(edited, [edited.parts[0].id]);
    expect(aligned.parts[0].captions?.map((cue) => cue.text)).toEqual(['最初の文。', '次の文。']);
    expect(captionMismatchParts(aligned)).toHaveLength(0);
  });

  it('手で直した時刻は、文面が台本と同じならそのまま使う', () => {
    const base = scene('最初の文。次の文。');
    const manual = [
      { id: crypto.randomUUID(), text: '最初の文。', start: 0, end: 3, timing: 'manual' as const },
      { id: crypto.randomUUID(), text: '次の文。', start: 3, end: 9, timing: 'manual' as const },
    ];
    expect(freshCaptions({ ...base, captions: manual })).toBe(manual);
  });

  it('一部のシーンだけ ON のときは mixed', () => {
    expect(captionState(project([scene('a。', { captionsEnabled: true }), scene('b。')]))).toBe(
      'mixed'
    );
  });
});
