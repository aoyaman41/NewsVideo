import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { normalizeSettings, type AppSettings } from '../../../shared/settings/appSettings';
import { FriendlyError } from '../errors/FriendlyError';
import { Button } from '../ui';
import { ApiKeyList } from './ApiKeyList';
import { API_KEY_SERVICE_INFO, requiredServices } from './apiKeys';
import { markWelcomeDismissed } from './onboardingState';
import { useApiKeyStatus } from './useApiKeyStatus';

/**
 * 初回起動時のようこそ画面。3 つの API キーを 1 画面で、取得先・入力・接続の確認まで案内する。
 * キーがなくてもサンプルは開ける。設定画面の「API キー」からも開き直せる。
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 設定画面から開いたときは、閉じたら設定画面へ戻る
  const returnTo =
    typeof (location.state as { returnTo?: unknown } | null)?.returnTo === 'string'
      ? (location.state as { returnTo: string }).returnTo
      : '/projects';
  const { status, markSaved } = useApiKeyStatus();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [openingSample, setOpeningSample] = useState(false);
  const [sampleError, setSampleError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    void window.electronAPI.settings
      .get()
      .then((value) => {
        if (active) setSettings(normalizeSettings(value));
      })
      .catch(() => {
        if (active) setSettings(normalizeSettings({}));
      });
    return () => {
      active = false;
    };
  }, []);

  const required = settings ? requiredServices(settings) : [];
  const missing = required.filter((service) => !status[service]);
  const ready = Boolean(settings) && missing.length === 0;

  const finish = () => {
    markWelcomeDismissed();
    navigate(returnTo, { replace: true });
  };

  const openSample = async () => {
    setOpeningSample(true);
    setSampleError(null);
    try {
      const created = await window.electronAPI.project.create({ name: 'サンプル', sample: true });
      markWelcomeDismissed();
      navigate(`/projects/${created.id}/video`, { replace: true });
    } catch (error) {
      setSampleError(error);
    } finally {
      setOpeningSample(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--nv-color-canvas)]">
      <div className="titlebar-drag h-10 shrink-0" aria-hidden="true" />
      <main className="flex-1 overflow-auto px-6 pb-10">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <header className="space-y-2">
            <p className="text-sm font-semibold text-[var(--nv-color-accent)]">NewsVideo</p>
            <h1 className="text-2xl font-bold text-[var(--nv-color-text)]">ようこそ</h1>
            <p className="text-sm text-[var(--nv-color-muted)]">
              記事を貼り付けて「おまかせで作る」を押すと、台本・画像・音声を AI
              が作り、報道動画に仕上げます。
            </p>
          </header>

          <section className="nv-surface space-y-4 p-5" aria-labelledby="welcome-keys-title">
            <div className="space-y-1">
              <h2
                id="welcome-keys-title"
                className="text-base font-semibold text-[var(--nv-color-text)]"
              >
                はじめに、AI サービスの API キーを設定します
              </h2>
              {settings && required.length > 0 && (
                <p className="text-sm font-semibold text-[var(--nv-color-text)]">
                  今の設定では、
                  {required.map((service) => API_KEY_SERVICE_INFO[service].name).join('・')} の{' '}
                  {required.length} つが必要です。
                </p>
              )}
              <p className="text-sm text-[var(--nv-color-muted)]">
                API キーは、アプリが AI
                サービスを使うための鍵です。各サービスの管理画面でキーを作り、
                コピーしてここに貼り付けてください。料金は各サービスに直接かかります。キーはこの Mac
                の中に暗号化して保存し、そのサービスへの接続にだけ使います。
              </p>
            </div>
            <ApiKeyList status={status} settings={settings ?? {}} onSaved={markSaved} />
          </section>

          {sampleError !== null && (
            <FriendlyError error={sampleError} onDismiss={() => setSampleError(null)} />
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Button
                variant="secondary"
                onClick={() => void openSample()}
                disabled={openingSample}
              >
                {openingSample ? 'サンプルを準備しています…' : 'サンプルを見る'}
              </Button>
              <p className="text-xs text-[var(--nv-color-muted)]">
                API キーがなくても、完成したサンプル動画を開いて操作を試せます。
              </p>
            </div>
            {ready ? (
              <Button size="lg" onClick={finish}>
                はじめる
              </Button>
            ) : (
              <div className="space-y-1 text-right">
                <Button variant="secondary" onClick={finish}>
                  あとで設定する
                </Button>
                <p className="text-xs text-[var(--nv-color-muted)]">
                  あとから「設定」の「API キー」でいつでも設定できます。
                </p>
              </div>
            )}
          </footer>
        </div>
      </main>
    </div>
  );
}
