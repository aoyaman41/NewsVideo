import { useEffect, useRef, useCallback } from 'react';

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

  const serialize = useCallback((d: T) => JSON.stringify(d), []);

  const isDirty = lastSavedDataRef.current !== serialize(data);

  const save = useCallback(async () => {
    if (isSavingRef.current) return;

    const currentData = serialize(data);
    if (lastSavedDataRef.current === currentData) return;

    isSavingRef.current = true;
    try {
      await onSave(data);
      lastSavedDataRef.current = currentData;
      lastSavedAtRef.current = new Date();
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      isSavingRef.current = false;
    }
  }, [data, onSave, serialize]);

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
      if (isDirty && enabled) {
        save();
      }
    };
  }, []);

  return {
    isDirty,
    lastSavedAt: lastSavedAtRef.current,
    saveNow: save,
  };
}
