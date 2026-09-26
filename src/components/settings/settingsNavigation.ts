import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type SettingsSection = 'api' | 'models' | 'video' | 'dictionary' | 'advanced';

export type SettingsLocationState = {
  /** 設定を閉じたときに戻る画面 */
  returnTo?: string;
  /** 最初に開く区分 */
  section?: SettingsSection;
};

export function readSettingsLocationState(state: unknown): SettingsLocationState {
  if (!state || typeof state !== 'object') return {};
  const value = state as Record<string, unknown>;
  const sections: SettingsSection[] = ['api', 'models', 'video', 'dictionary', 'advanced'];
  return {
    returnTo:
      typeof value.returnTo === 'string' && value.returnTo && value.returnTo !== '/settings'
        ? value.returnTo
        : undefined,
    section: sections.includes(value.section as SettingsSection)
      ? (value.section as SettingsSection)
      : undefined,
  };
}

/** 今の画面を戻り先にして、設定画面の指定の区分を開く */
export function useOpenSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (section: SettingsSection) => {
      const current = `${location.pathname}${location.search}`;
      const state: SettingsLocationState = {
        section,
        returnTo: current.startsWith('/settings')
          ? readSettingsLocationState(location.state).returnTo
          : current,
      };
      navigate('/settings', { state });
    },
    [location.pathname, location.search, location.state, navigate]
  );
}
