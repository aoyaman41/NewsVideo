export function contentSecurityPolicy(developmentUrl?: string) {
  const development = developmentUrl ? new URL(developmentUrl) : null;
  const websocket = development
    ? ` ${development.protocol === 'https:' ? 'wss:' : 'ws:'}//${development.host}`
    : '';
  return `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: local-file:; media-src 'self' blob: local-file:; connect-src 'self' local-file:${websocket}; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`;
}
