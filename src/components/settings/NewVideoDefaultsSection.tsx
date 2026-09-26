import { useState } from 'react';
import { Button, Card, Checkbox, useConfirm, useToast } from '../ui';
import { errorToastContent, explainError } from '../errors/explainError';
import { budgetToUsd } from '../../stores/generationPreferences';
import { formatCost } from '../../utils/money';
import {
  PURPOSES,
  PURPOSE_SPECS,
  describePurpose,
  purposeProfile,
  type PurposeId,
} from '../../../shared/project/purposes';
import {
  IMAGE_STYLE_PRESETS,
  IMAGE_STYLE_PRESET_DESCRIPTIONS,
  IMAGE_STYLE_PRESET_LABELS,
} from '../../../shared/project/imageStylePresets';
import {
  TTS_NARRATION_STYLE_LABELS,
  TTS_NARRATION_STYLE_PRESETS,
  type TtsNarrationStylePreset,
} from '../../../shared/project/ttsNarrationStyles';
import type {
  ClosingLineMode,
  SourceDisplayMode,
} from '../../../shared/project/presentationProfile';
import type { AppSettings, NewProjectDefaults } from '../../../shared/settings/appSettings';

const fieldLabel = 'nv-label';
const fieldHint = 'nv-help mt-1';

const CLOSING_LINE_LABELS: Record<ClosingLineMode, string> = {
  preset: '用途に合わせた定型文',
  none: '入れない',
  custom: '自分で入力する',
};

const SOURCE_DISPLAY_LABELS: Record<SourceDisplayMode, string> = {
  auto: '記事の出典を使う',
  hidden: '表示しない',
  custom: '自分で入力する',
};

/** 「用途に合わせる」の選択肢の値(保存値は null) */
const FOLLOW_PURPOSE = '';

/** 用途ごとの既定値の説明(「ニュース: ニュース調・ショート: カジュアル」など) */
function perPurpose(describe: (id: PurposeId) => string): string {
  return PURPOSES.map(
    (purpose) => `${purpose.label.replace(/^.*・/, '')}: ${describe(purpose.id as PurposeId)}`
  ).join('、');
}

/**
 * 設定画面の「新しい動画」区分。これから作る動画の既定値(用途・見た目・締め・進め方と予算)を決める。
 * 作成済みの動画は変えない。台本がまだない動画には、ボタンで入れ直せる。
 */
export function NewVideoDefaultsSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [applying, setApplying] = useState(false);
  const defaults = settings.newProjectDefaults;
  const purpose = PURPOSE_SPECS[defaults.purpose];
  const updateDefaults = (patch: Partial<NewProjectDefaults>) =>
    onChange({ newProjectDefaults: { ...defaults, ...patch } });

  const applyToDrafts = async () => {
    setApplying(true);
    try {
      const { count } = await window.electronAPI.project.applyNewProjectDefaults({
        defaults,
        dryRun: true,
      });
      if (count === 0) {
        toast.info('台本がまだない動画はありません。', '反映する動画がありません');
        return;
      }
      const accepted = await confirm({
        title: `台本がまだない ${count} 本の動画に反映しますか？`,
        description:
          '画像の雰囲気・話し方・締め・出典の表示を、この既定値に置き換えます。用途・画面の縦横・長さは変えません。台本や素材がある動画は変わりません。',
        confirmLabel: '反映する',
        confirmVariant: 'primary',
      });
      if (!accepted) return;
      const result = await window.electronAPI.project.applyNewProjectDefaults({ defaults });
      toast.success(`${result.count} 本の動画に反映しました`);
    } catch (error) {
      const content = errorToastContent(explainError(error), '既定値を反映できませんでした');
      toast.error(content.message, content.title);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Card
      title="新しい動画"
      subtitle="これから作る動画に使います。作成済みの動画は変わりません。"
      actions={
        <Button
          size="sm"
          variant="secondary"
          disabled={applying}
          onClick={() => void applyToDrafts()}
        >
          まだ台本がない動画にも適用
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">用途</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="defaults-purpose" className={fieldLabel}>
                最初に選ばれている用途
              </label>
              <select
                id="defaults-purpose"
                value={defaults.purpose}
                onChange={(e) => updateDefaults({ purpose: e.target.value as PurposeId })}
                className="nv-input"
              >
                {PURPOSES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className={fieldHint}>
                {describePurpose(purpose)}。画面の縦横・長さ・シーン数は用途で決まります。
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">画像と声</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="defaults-image-style" className={fieldLabel}>
                画像の雰囲気
              </label>
              <select
                id="defaults-image-style"
                value={defaults.imageStylePreset}
                onChange={(e) =>
                  updateDefaults({
                    imageStylePreset: e.target.value as NewProjectDefaults['imageStylePreset'],
                  })
                }
                className="nv-input"
              >
                {IMAGE_STYLE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {IMAGE_STYLE_PRESET_LABELS[preset]}
                  </option>
                ))}
              </select>
              <p className={fieldHint}>
                {IMAGE_STYLE_PRESET_DESCRIPTIONS[defaults.imageStylePreset]}
              </p>
            </div>
            <div>
              <label htmlFor="defaults-image-note" className={fieldLabel}>
                画像の補足(任意)
              </label>
              <input
                id="defaults-image-note"
                type="text"
                value={defaults.styleReferenceNote}
                onChange={(e) => updateDefaults({ styleReferenceNote: e.target.value })}
                className="nv-input"
                placeholder="例: 太い見出し、青いカード背景"
              />
            </div>
            <div>
              <label htmlFor="defaults-voice-style" className={fieldLabel}>
                読み上げの話し方
              </label>
              <select
                id="defaults-voice-style"
                value={defaults.ttsNarrationStylePreset ?? FOLLOW_PURPOSE}
                onChange={(e) =>
                  updateDefaults({
                    ttsNarrationStylePreset:
                      e.target.value === FOLLOW_PURPOSE
                        ? null
                        : (e.target.value as TtsNarrationStylePreset),
                  })
                }
                className="nv-input"
              >
                <option value={FOLLOW_PURPOSE}>用途に合わせる</option>
                {TTS_NARRATION_STYLE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {TTS_NARRATION_STYLE_LABELS[preset]}
                  </option>
                ))}
              </select>
              {defaults.ttsNarrationStylePreset === null && (
                <p className={fieldHint}>
                  {perPurpose(
                    (id) => TTS_NARRATION_STYLE_LABELS[purposeProfile(id).ttsNarrationStylePreset]
                  )}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="defaults-voice-note" className={fieldLabel}>
                読み上げの補足(任意)
              </label>
              <input
                id="defaults-voice-note"
                type="text"
                value={defaults.ttsNarrationStyleNote}
                onChange={(e) => updateDefaults({ ttsNarrationStyleNote: e.target.value })}
                className="nv-input"
                placeholder="例: 語尾はやわらかく、あおりすぎない"
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">締め</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="defaults-closing" className={fieldLabel}>
                締めのひとこと(読み上げ)
              </label>
              <select
                id="defaults-closing"
                value={defaults.closingLineMode}
                onChange={(e) =>
                  updateDefaults({ closingLineMode: e.target.value as ClosingLineMode })
                }
                className="nv-input"
              >
                {(Object.keys(CLOSING_LINE_LABELS) as ClosingLineMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {CLOSING_LINE_LABELS[mode]}
                  </option>
                ))}
              </select>
              {defaults.closingLineMode === 'custom' && (
                <input
                  type="text"
                  aria-label="締めのひとこと(自分で入力)"
                  value={defaults.closingLineText}
                  onChange={(e) => updateDefaults({ closingLineText: e.target.value })}
                  className="nv-input mt-2"
                  placeholder="ご視聴ありがとうございました"
                />
              )}
            </div>
            <div className="space-y-3">
              <Checkbox
                checked={defaults.closingCardEnabled}
                onChange={(checked) => updateDefaults({ closingCardEnabled: checked })}
                label="締めの画面を入れる"
                description="動画の最後に出す画面です。"
              />
              {defaults.closingCardEnabled && (
                <>
                  <div>
                    <label htmlFor="defaults-closing-headline" className={fieldLabel}>
                      締めの画面の見出し
                    </label>
                    <input
                      id="defaults-closing-headline"
                      type="text"
                      value={defaults.closingCardHeadline}
                      onChange={(e) => updateDefaults({ closingCardHeadline: e.target.value })}
                      className="nv-input"
                      placeholder="空欄なら用途に合わせます"
                    />
                  </div>
                  <div>
                    <label htmlFor="defaults-closing-message" className={fieldLabel}>
                      締めの画面のひとこと(任意)
                    </label>
                    <input
                      id="defaults-closing-message"
                      type="text"
                      value={defaults.closingCardCtaText}
                      onChange={(e) => updateDefaults({ closingCardCtaText: e.target.value })}
                      className="nv-input"
                      placeholder="続きは概要欄から確認してください"
                    />
                  </div>
                </>
              )}
            </div>
            <div>
              <label htmlFor="defaults-source" className={fieldLabel}>
                出典の表示
              </label>
              <select
                id="defaults-source"
                value={defaults.sourceDisplayMode ?? FOLLOW_PURPOSE}
                onChange={(e) =>
                  updateDefaults({
                    sourceDisplayMode:
                      e.target.value === FOLLOW_PURPOSE
                        ? null
                        : (e.target.value as SourceDisplayMode),
                  })
                }
                className="nv-input"
              >
                <option value={FOLLOW_PURPOSE}>用途に合わせる</option>
                {(Object.keys(SOURCE_DISPLAY_LABELS) as SourceDisplayMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {SOURCE_DISPLAY_LABELS[mode]}
                  </option>
                ))}
              </select>
              {defaults.sourceDisplayMode === null && (
                <p className={fieldHint}>
                  {perPurpose((id) => SOURCE_DISPLAY_LABELS[purposeProfile(id).sourceDisplayMode])}
                </p>
              )}
              {defaults.sourceDisplayMode === 'custom' && (
                <input
                  type="text"
                  aria-label="出典として表示する文"
                  value={defaults.sourceDisplayText}
                  onChange={(e) => updateDefaults({ sourceDisplayText: e.target.value })}
                  className="nv-input mt-2"
                  placeholder="出典: 社内広報資料"
                />
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">進め方と予算</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="settings-mode" className={fieldLabel}>
                自動生成の進め方
              </label>
              <select
                id="settings-mode"
                value={settings.generationMode}
                onChange={(e) =>
                  onChange({
                    generationMode: e.target.value === 'review' ? 'review' : 'automatic',
                  })
                }
                className="nv-input"
              >
                <option value="automatic">最後まで自動で進める(おすすめ)</option>
                <option value="review">台本と素材ができたところで止めて確認する</option>
              </select>
            </div>
            <div>
              <label htmlFor="settings-budget" className={fieldLabel}>
                1 回の予算の上限(USD)
              </label>
              <input
                id="settings-budget"
                type="number"
                min="0"
                step="0.1"
                value={settings.generationBudgetUsd ?? ''}
                onChange={(e) =>
                  onChange({ generationBudgetUsd: budgetToUsd(e.target.value) ?? null })
                }
                className="nv-input w-32"
                placeholder="上限なし"
              />
              <p className={fieldHint}>
                {settings.generationBudgetUsd !== null
                  ? `${formatCost(settings.generationBudgetUsd, settings.jpyPerUsd)}まで。`
                  : ''}
                空欄なら上限なし。見込みをもとに判断するため、実際の料金を厳密に上限に抑えるものではありません。
              </p>
            </div>
          </div>
          <p className="nv-help">
            記事画面の「詳細設定」で変えた進め方と予算は、その回の生成だけに使います。
          </p>
        </section>
      </div>
    </Card>
  );
}
