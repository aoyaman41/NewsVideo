export function toLocalFileUrl(filePath: string): string {
  // Prefer an "empty host" URL form (local-file:///...) for better compatibility with media elements.
  // Encode per-path-segment so reserved characters like `?`/`#` in filenames are safe.
  const normalized = filePath.replace(/\\/g, '/');

  const ensureLeadingSlash =
    normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
      ? `/${normalized.replace(/^\/+/, '')}`
      : `/${normalized}`;

  const encodedPath = ensureLeadingSlash
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `local-file://${encodedPath}`;
}

