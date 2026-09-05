import { useState } from 'react';
import type { Project, Part } from '../../schemas';
import { estimateCaptions, captionProblems } from '../../../shared/project/captions';
import { toLocalFileUrl } from '../../utils/toLocalFileUrl';
import { projectClient } from '../../stores/projectStore';
import { Button, Card } from '../ui';
export function FinishingEditor({
  project,
  part,
  onChange,
}: {
  project: Project;
  part: Part;
  onChange: (project: Project) => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dictionary, setDictionary] = useState('');
  const [dictionaryLoaded, setDictionaryLoaded] = useState(false);
  const [pauseAt, setPauseAt] = useState(0);
  const [pauseSeconds, setPauseSeconds] = useState(0.5);
  const captions = part.captions ?? [];
  const update = (changes: Partial<Part>) =>
    onChange({
      ...project,
      parts: project.parts.map((item) => (item.id === part.id ? { ...item, ...changes } : item)),
    });
  const action = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await projectClient.flush(project.id);
      await operation();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const graphic = part.graphic ?? {
    enabled: false,
    headline: part.title,
    keyNumber: '',
    source: project.article.source ?? '',
    bars: [],
  };
  const analyze = async () => {
    if (!part.audio) return;
    const response = await fetch(toLocalFileUrl(part.audio.filePath));
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(await response.arrayBuffer());
      let peak = 0,
        energy = 0,
        quiet = 0,
        clips = 0;
      for (let ch = 0; ch < audio.numberOfChannels; ch++)
        for (const sample of audio.getChannelData(ch)) {
          const value = Math.abs(sample);
          peak = Math.max(peak, value);
          energy += value * value;
          if (value < 0.003162) quiet++;
          if (value >= 0.999) clips++;
        }
      const count = audio.length * audio.numberOfChannels;
      setMessage(
        `音声実測: ${audio.duration.toFixed(2)}秒 / ピーク ${(20 * Math.log10(Math.max(peak, 1e-8))).toFixed(1)} dBFS / RMS ${(20 * Math.log10(Math.max(Math.sqrt(energy / count), 1e-8))).toFixed(1)} dBFS / −50 dBFS未満 ${((quiet / count) * 100).toFixed(1)}% / クリッピング候補 ${clips}サンプル。RMSはラウドネスLUFSではありません。`
      );
    } finally {
      await context.close();
    }
  };
  return (
    <Card title="字幕・読み・仕上げ">
      <div className="space-y-3 text-sm">
        <details>
          <summary className="cursor-pointer">字幕と同期を編集</summary>
          <div className="space-y-2 pt-2">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => update({ captions: estimateCaptions(part) })}
              >
                原稿から字幕を作る
              </Button>
              <label>
                <input
                  type="checkbox"
                  checked={part.captionsEnabled ?? false}
                  onChange={(e) => update({ captionsEnabled: e.target.checked })}
                />{' '}
                映像に字幕を表示
              </label>
            </div>
            <p>
              時刻は「TTS時刻」「推定」「手動」を区別します。書き出す前に音声と照合してください。
            </p>
            {captions.map((cue, i) => (
              <fieldset key={cue.id} className="space-y-2 rounded border p-2">
                <legend>
                  字幕 {i + 1} · {{ tts: 'TTS時刻', estimated: '推定', manual: '手動' }[cue.timing]}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['start', 'end'] as const).map((field) => (
                    <label key={field}>
                      {field === 'start' ? '開始' : '終了'}秒
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="nv-input"
                        value={cue[field]}
                        onChange={(e) =>
                          update({
                            captions: captions.map((item) =>
                              item.id === cue.id
                                ? {
                                    ...item,
                                    [field]: Math.max(0, Number(e.target.value)),
                                    timing: 'manual',
                                  }
                                : item
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <textarea
                  aria-label={`字幕${i + 1}の文章`}
                  rows={2}
                  className="nv-input"
                  value={cue.text}
                  onChange={(e) =>
                    update({
                      captions: captions.map((item) =>
                        item.id === cue.id ? { ...item, text: e.target.value } : item
                      ),
                    })
                  }
                />
                <Button
                  disabled={busy || !part.audio}
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void action(async () => {
                      await window.electronAPI.tts.replaceSegment({
                        projectId: project.id,
                        partId: part.id,
                        start: cue.start,
                        end: cue.end,
                        text: cue.text,
                      });
                      setMessage('この字幕区間の音声を置き換えました。境界を試聴してください。');
                    })
                  }
                >
                  この区間だけ音声を再生成（API使用時は課金）
                </Button>
              </fieldset>
            ))}
            {captionProblems(captions, part.audio?.durationSec ?? part.durationEstimateSec).map(
              (problem) => (
                <p key={problem} className="text-amber-800">
                  {problem}
                </p>
              )
            )}
            <div className="flex gap-2">
              {(['srt', 'vtt'] as const).map((format) => (
                <Button
                  key={format}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      setMessage(
                        `字幕を書き出しました: ${await window.electronAPI.project.captions({ id: project.id, format })}`
                      )
                    )
                  }
                >
                  {format.toUpperCase()}を書き出す
                </Button>
              ))}
            </div>
          </div>
        </details>
        <details>
          <summary className="cursor-pointer">読み方と間を調整</summary>
          <div className="space-y-2 pt-2">
            <label className="block">
              読み上げ専用の原稿（空欄は台本を使用）
              <textarea
                rows={3}
                className="nv-input"
                value={part.narrationText ?? ''}
                onChange={(e) => update({ narrationText: e.target.value })}
              />
            </label>
            <p className="text-xs">
              ひらがな・カタカナで読みを指定できます。アクセントや声の調子は生成設定の音声スタイル補足で調整します。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label>
                挿入位置（秒）
                <input
                  type="number"
                  className="nv-input"
                  min="0"
                  value={pauseAt}
                  onChange={(e) => setPauseAt(Number(e.target.value))}
                />
              </label>
              <label>
                間の長さ（秒）
                <input
                  type="number"
                  className="nv-input"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={pauseSeconds}
                  onChange={(e) => setPauseSeconds(Number(e.target.value))}
                />
              </label>
            </div>
            <Button
              disabled={busy || !part.audio}
              variant="secondary"
              size="sm"
              onClick={() =>
                void action(async () => {
                  await window.electronAPI.tts.insertPause({
                    projectId: project.id,
                    partId: part.id,
                    at: pauseAt,
                    seconds: pauseSeconds,
                  });
                  setMessage('無音の間を追加しました。全体再生成では元の読み上げに戻ります。');
                })
              }
            >
              間を追加（API不要）
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void action(async () => {
                  const settings = await window.electronAPI.settings.get();
                  setDictionary(
                    (settings.readingDictionary ?? [])
                      .map((entry) => `${entry.word}=${entry.reading}`)
                      .join('\n')
                  );
                  setDictionaryLoaded(true);
                })
              }
            >
              全プロジェクト共通の読み辞書を開く
            </Button>
            {dictionaryLoaded && (
              <>
                <label className="block">
                  1行に「表記=読み」
                  <textarea
                    rows={4}
                    className="nv-input"
                    value={dictionary}
                    onChange={(e) => setDictionary(e.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void action(async () => {
                      const readingDictionary = dictionary
                        .split('\n')
                        .filter((line) => line.trim())
                        .map((line) => {
                          const index = line.indexOf('=');
                          if (index < 1) throw new Error('各行を「表記=読み」で入力してください。');
                          return {
                            word: line.slice(0, index).trim(),
                            reading: line.slice(index + 1).trim(),
                          };
                        });
                      await window.electronAPI.settings.set({ readingDictionary });
                      onChange({
                        ...project,
                        generationConfig: { ...project.generationConfig, readingDictionary },
                      });
                      setMessage(
                        '共通の読み辞書を保存しました。既存音声は必要に応じて再生成してください。'
                      );
                    })
                  }
                >
                  辞書を保存
                </Button>
              </>
            )}
          </div>
        </details>
        <details>
          <summary className="cursor-pointer">画像と分離した文字・数値・図表</summary>
          <div className="space-y-2 pt-2">
            <label>
              <input
                type="checkbox"
                checked={graphic.enabled}
                onChange={(e) => update({ graphic: { ...graphic, enabled: e.target.checked } })}
              />{' '}
              編集可能なグラフィックを重ねる
            </label>
            {(['headline', 'keyNumber', 'source'] as const).map((field) => (
              <label className="block" key={field}>
                {
                  { headline: '見出し', keyNumber: '強調する数値', source: '出典・クレジット' }[
                    field
                  ]
                }
                <input
                  className="nv-input"
                  value={graphic[field]}
                  onChange={(e) => update({ graphic: { ...graphic, [field]: e.target.value } })}
                />
              </label>
            ))}
            {graphic.bars.map((bar, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <input
                  aria-label={`棒グラフ${i + 1}の名称`}
                  className="nv-input"
                  value={bar.label}
                  onChange={(e) =>
                    update({
                      graphic: {
                        ...graphic,
                        bars: graphic.bars.map((item, n) =>
                          n === i ? { ...item, label: e.target.value } : item
                        ),
                      },
                    })
                  }
                />
                <input
                  aria-label={`棒グラフ${i + 1}の値（0から100）`}
                  type="number"
                  min="0"
                  max="100"
                  className="nv-input"
                  value={bar.value}
                  onChange={(e) =>
                    update({
                      graphic: {
                        ...graphic,
                        bars: graphic.bars.map((item, n) =>
                          n === i ? { ...item, value: Number(e.target.value) } : item
                        ),
                      },
                    })
                  }
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              disabled={graphic.bars.length >= 4}
              onClick={() =>
                update({
                  graphic: { ...graphic, bars: [...graphic.bars, { label: '項目', value: 50 }] },
                })
              }
            >
              棒グラフを追加
            </Button>
            <p className="text-xs">
              AI画像は背景として使い、文字や値の修正はAPIを呼ばずに動画へ反映します。
            </p>
          </div>
        </details>
        <Button
          disabled={!part.audio || busy}
          variant="secondary"
          size="sm"
          onClick={() => void action(analyze)}
        >
          音声の音量・無音・クリッピングを実測
        </Button>
        {message && (
          <p role="status" className="rounded bg-slate-100 p-2 whitespace-pre-wrap">
            {message}
          </p>
        )}
      </div>
    </Card>
  );
}
