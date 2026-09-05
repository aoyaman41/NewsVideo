import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function isTrustedRenderer(
  url: string,
  packaged: boolean,
  appPath: string,
  developmentUrl = 'http://localhost:5173'
) {
  try {
    const parsed = new URL(url);
    if (!packaged)
      return (
        parsed.origin === new URL(developmentUrl).origin &&
        ['http:', 'https:'].includes(parsed.protocol)
      );
    return (
      parsed.protocol === 'file:' &&
      path.resolve(fileURLToPath(parsed)) === path.resolve(appPath, 'dist', 'index.html')
    );
  } catch {
    return false;
  }
}
