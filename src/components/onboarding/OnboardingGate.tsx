import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeSettings } from '../../../shared/settings/appSettings';
import { requiredServices } from './apiKeys';
import { isWelcomeDismissed } from './onboardingState';
import { loadApiKeyStatus } from './useApiKeyStatus';

let checkedThisSession = false;

function isOnStartPage(): boolean {
  const hash = window.location.hash.replace(/^#/, '');
  return hash === '' || hash === '/' || hash === '/projects';
}

/**
 * 初回起動(プロジェクトがまだ 1 つもない)のときに 1 回だけ、今の設定で必要な API キーが
 * そろっているかを確かめ、足りなければようこそ画面を開く。「あとで設定する」などで閉じたあとは
 * 自動では開かない。プロジェクトがある人には自動では出さず、記事画面の案内と設定画面から設定する。
 */
export function OnboardingGate() {
  const navigate = useNavigate();

  useEffect(() => {
    if (checkedThisSession) return;
    checkedThisSession = true;
    if (isWelcomeDismissed() || !isOnStartPage()) return;
    // StrictMode の二重実行でも 1 回だけ確かめる(この部品はアプリの最上位に常にある)
    void (async () => {
      try {
        const [settings, status, projects] = await Promise.all([
          window.electronAPI.settings.get().catch(() => ({})),
          loadApiKeyStatus(),
          window.electronAPI.project.list(),
        ]);
        if (projects.length > 0) return;
        const missing = requiredServices(normalizeSettings(settings)).filter(
          (service) => !status[service]
        );
        if (missing.length > 0 && isOnStartPage()) navigate('/welcome', { replace: true });
      } catch {
        /* 確かめられないときは案内を出さない(設定画面から開ける) */
      }
    })();
  }, [navigate]);

  return null;
}
