import { expect, it } from 'vitest';
import { isTrustedRenderer } from './ipcOrigin';

it('accepts only the configured renderer origin or the exact packaged document', () => {
  expect(isTrustedRenderer('http://localhost:5173/#/projects', false, '/app')).toBe(true);
  expect(isTrustedRenderer('http://localhost:5173.evil.test', false, '/app')).toBe(false);
  expect(isTrustedRenderer('https://evil.test', false, '/app')).toBe(false);
  expect(isTrustedRenderer('file:///app/dist/index.html#/settings', true, '/app')).toBe(true);
  expect(isTrustedRenderer('file:///app/other.html', true, '/app')).toBe(false);
  expect(isTrustedRenderer('http://localhost:5173', true, '/app')).toBe(false);
});
