import { useCallback, useSyncExternalStore } from 'react';
const values = new Map<string, string | null>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useSceneSelection(id?: string) {
  const selected = useSyncExternalStore(subscribe, () => id ? values.get(id) ?? null : null);
  const select = useCallback((value: string | null | ((previous: string | null) => string | null)) => {
    if (!id) return;
    values.set(id, typeof value === 'function' ? value(values.get(id) ?? null) : value);
    listeners.forEach((listener) => listener());
  }, [id]);
  return [selected, select] as const;
}
export const rememberedScene = (id: string, fallback: string) => values.get(id) ?? fallback;
