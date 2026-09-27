import { useSyncExternalStore } from 'react';
import {
  DEFAULT_JPY_PER_USD,
  isValidJpyPerUsd,
  normalizeSettings,
} from '../../shared/settings/appSettings';

/**
 * 金額の表示に使う為替レート(設定の jpyPerUsd)を、画面をまたいで共有する。
 * 設定を読んでいない画面(画面上部の進捗表示など)は、最初に使うときに 1 回だけ設定を読む。
 * 設定画面で変えたら setJpyPerUsd で知らせる(保存を待たずに表示を変える)。
 */
let rate = DEFAULT_JPY_PER_USD;
let requested = false;
const listeners = new Set<() => void>();

export function setJpyPerUsd(value: number): void {
  if (!isValidJpyPerUsd(value) || value === rate) return;
  rate = value;
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  if (requested) return;
  requested = true;
  try {
    void window.electronAPI.settings
      .get()
      .then((settings) => setJpyPerUsd(normalizeSettings(settings).jpyPerUsd))
      .catch(() => {});
  } catch {
    /* 設定を読めなくても既定のレートで表示する */
  }
}

function subscribe(listener: () => void) {
  ensureLoaded();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useJpyPerUsd(): number {
  return useSyncExternalStore(
    subscribe,
    () => rate,
    () => rate
  );
}
