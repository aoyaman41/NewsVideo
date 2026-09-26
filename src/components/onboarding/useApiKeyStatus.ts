import { useCallback, useEffect, useState } from 'react';
import { API_KEY_SERVICES, type ApiKeyService } from './apiKeys';

export type ApiKeyStatus = Record<ApiKeyService, boolean | null>;

const UNKNOWN: ApiKeyStatus = { anthropic: null, openai: null, google_ai: null };

/** 保存済みの API キーの有無(settings:hasApiKey)。キーの値そのものは読まない */
export async function loadApiKeyStatus(): Promise<Record<ApiKeyService, boolean>> {
  const entries = await Promise.all(
    API_KEY_SERVICES.map(async (service) => {
      try {
        return [service, await window.electronAPI.settings.hasApiKey(service)] as const;
      } catch {
        return [service, false] as const;
      }
    })
  );
  return Object.fromEntries(entries) as Record<ApiKeyService, boolean>;
}

export function useApiKeyStatus() {
  const [status, setStatus] = useState<ApiKeyStatus>(UNKNOWN);

  const refresh = useCallback(async () => {
    const next = await loadApiKeyStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    void loadApiKeyStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const markSaved = useCallback((service: ApiKeyService) => {
    setStatus((previous) => ({ ...previous, [service]: true }));
  }, []);

  return { status, refresh, markSaved, loaded: Object.values(status).every((v) => v !== null) };
}
