import { useId, useState } from 'react';
import type { Tone } from '../../types/ui';
import { cleanErrorMessage } from '../errors/explainError';
import { Button, StatusChip } from '../ui';
import {
  API_KEY_SERVICE_INFO,
  API_KEY_SERVICES,
  explainConnectionResult,
  formatUsages,
  serviceUsages,
  type ApiKeyService,
  type ModelSelection,
} from './apiKeys';
import type { ApiKeyStatus } from './useApiKeyStatus';

type CheckResult = { ok: boolean; summary: string; detail: string };

function chipFor(
  saved: boolean | null,
  result: CheckResult | null,
  required: boolean
): { tone: Tone; label: string } {
  if (result)
    return result.ok
      ? { tone: 'success', label: '使えます' }
      : { tone: 'danger', label: '使えません' };
  if (saved === null) return { tone: 'neutral', label: '確認中' };
  if (saved) return { tone: 'info', label: '保存済み' };
  return required ? { tone: 'warning', label: '未設定' } : { tone: 'neutral', label: '未設定' };
}

function ApiKeyRow({
  service,
  index,
  saved,
  usages,
  onSaved,
}: {
  service: ApiKeyService;
  index: number;
  saved: boolean | null;
  usages: string[];
  onSaved: (service: ApiKeyService) => void;
}) {
  const info = API_KEY_SERVICE_INFO[service];
  const inputId = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'saving' | 'testing' | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const required = usages.length > 0;
  const chip = chipFor(saved, result, required);

  const test = async (secret?: string) => {
    setBusy('testing');
    try {
      setResult(
        explainConnectionResult(await window.electronAPI.settings.testConnection(service), secret)
      );
    } catch (error) {
      const detail = cleanErrorMessage(error);
      setResult({
        ok: false,
        summary: '確認できませんでした。',
        detail: secret ? detail.split(secret).join('[キーを伏せました]') : detail,
      });
    } finally {
      setBusy(null);
    }
  };

  const saveAndTest = async () => {
    const key = value.trim();
    if (!key) return;
    setBusy('saving');
    setResult(null);
    try {
      await window.electronAPI.settings.setApiKey(service, key);
      setValue('');
      onSaved(service);
    } catch (error) {
      setResult({
        ok: false,
        summary: 'キーを保存できませんでした。',
        detail: cleanErrorMessage(error).split(key).join('[キーを伏せました]'),
      });
      setBusy(null);
      return;
    }
    await test(key);
  };

  return (
    <li className="nv-surface-muted p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={inputId} className="text-sm font-semibold text-[var(--nv-color-text)]">
            {index}. {info.name}({info.company})
          </label>
          <p className="mt-0.5 text-xs text-[var(--nv-color-muted)]">
            {required
              ? `${formatUsages(usages)}を作るのに使います`
              : '今の設定では使いません(生成モデルを変えると必要になります)'}
          </p>
        </div>
        <StatusChip tone={chip.tone} label={chip.label} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void saveAndTest();
            }
          }}
          placeholder={saved ? '保存済み(置き換えるときだけ貼り付け)' : 'ここにキーを貼り付け'}
          className="nv-input min-w-[240px] flex-1 font-mono text-sm"
        />
        <Button onClick={() => void saveAndTest()} disabled={!value.trim() || busy !== null}>
          {busy === 'saving' ? '保存中…' : busy === 'testing' ? '確認中…' : '保存して確認'}
        </Button>
        {saved && !value.trim() && (
          <Button variant="secondary" onClick={() => void test()} disabled={busy !== null}>
            {busy === 'testing' ? '確認中…' : '接続を確認'}
          </Button>
        )}
      </div>
      <a
        href={info.url}
        target="_blank"
        rel="noopener noreferrer"
        className="nv-focus-ring mt-2 inline-block rounded-[var(--nv-radius-sm)] text-xs font-semibold text-[var(--nv-color-accent)] hover:underline"
      >
        {info.urlLabel}(ブラウザで開きます)
      </a>
      {result && (
        <div className="mt-2 text-xs" role="status">
          <p
            className={
              result.ok ? 'text-[var(--nv-color-success)]' : 'text-[var(--nv-color-danger)]'
            }
          >
            {result.summary}
          </p>
          {result.detail && (
            <details className="mt-1 text-[var(--nv-color-muted)]">
              <summary className="nv-focus-ring w-fit cursor-pointer rounded-[var(--nv-radius-sm)]">
                詳しい内容
              </summary>
              <p className="mt-1 break-all">{result.detail}</p>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

/** 3 つの API キーを 1 か所で案内する(ようこそ画面と設定画面で共通) */
export function ApiKeyList({
  status,
  settings,
  onSaved,
}: {
  status: ApiKeyStatus;
  settings: ModelSelection;
  onSaved: (service: ApiKeyService) => void;
}) {
  const usages = serviceUsages(settings);
  return (
    <ol className="space-y-3">
      {API_KEY_SERVICES.map((service, index) => (
        <ApiKeyRow
          key={service}
          service={service}
          index={index + 1}
          saved={status[service]}
          usages={usages[service]}
          onSaved={onSaved}
        />
      ))}
    </ol>
  );
}
