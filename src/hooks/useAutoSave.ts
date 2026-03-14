import { useEffect, useRef, useCallback, useState } from 'react';

interface UseAutoSaveOptions<T> {
  data: T;
  onSave: (data: T) => Promise<void>;
  interval?: number; // デフォルト: 30秒
  enabled?: boolean;
}

interface UseAutoSaveReturn {
  isDirty: boolean;
  lastSavedAt: Date | null;
  saveNow: () => Promise<void>;
  isSaving: boolean;
}

export function useAutoSave<T>({
  data,
  onSave,
  interval = 30000,
  enabled = true,
}: UseAutoSaveOptions<T>): UseAutoSaveReturn {
  const lastSavedDataRef = useRef<string | null>(null);
  const lastSavedAtRef = useRef<Date | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const isMountedRef = useRef(true);
  const latestIsDirtyRef = useRef(false);
  const latestEnabledRef = useRef(enabled);
  const latestSaveRef = useRef<() => Promise<void>>(async () => {});
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const serialize = useCallback((d: T) => JSON.stringify(d), []);

  const isDirty = lastSavedDataRef.current !== serialize(data);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (lastSavedDataRef.current !== null) return;
    const snapshot = serialize(data);
    lastSavedDataRef.current = snapshot;
    const now = new Date();
    lastSavedAtRef.current = now;
    setLastSavedAt(now);
  }, [data, enabled, serialize]);

  const save = useCallback(async () => {
    if (isSavingRef.current) return;

    const currentData = serialize(data);
    if (lastSavedDataRef.current === currentData) return;

    isSavingRef.current = true;
    if (isMountedRef.current) setIsSaving(true);
    try {
      await onSave(data);
      lastSavedDataRef.current = currentData;
      const now = new Date();
      lastSavedAtRef.current = now;
      if (isMountedRef.current) setLastSavedAt(now);
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) setIsSaving(false);
    }
  }, [data, onSave, serialize]);

  useEffect(() => {
    latestIsDirtyRef.current = isDirty;
    latestEnabledRef.current = enabled;
    latestSaveRef.current = save;
  }, [isDirty, enabled, save]);

  // デバウンスされた自動保存
  useEffect(() => {
    if (!enabled) return;

    // 前回のタイマーをクリア
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // データが変更されている場合、タイマーをセット
    if (isDirty) {
      timeoutRef.current = setTimeout(() => {
        save();
      }, interval);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [data, enabled, interval, isDirty, save]);

  // アンマウント時に未保存データを保存
  useEffect(() => {
    return () => {
      if (latestIsDirtyRef.current && latestEnabledRef.current) {
        void latestSaveRef.current();
      }
    };
  }, []);

  return {
    isDirty,
    lastSavedAt,
    saveNow: save,
    isSaving,
  };
}
