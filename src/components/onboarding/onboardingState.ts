/**
 * ようこそ画面を「あとで設定する」などで閉じたかどうか。この Mac の画面側だけで覚える
 * (設定ファイルのスキーマは変えない)。キーがそろっていればそもそも表示しない。
 */
const STORAGE_KEY = 'newsvideo.welcome.dismissed.v1';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function isWelcomeDismissed(): boolean {
  try {
    return storage()?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeDismissed(): void {
  try {
    storage()?.setItem(STORAGE_KEY, '1');
  } catch {
    /* 覚えられなくても次回また案内が出るだけ */
  }
}
