import { describe, expect, it } from 'vitest';
import { generateKioskShellHtml } from '@astellum/renderer';
import { langFor, LANG_COOKIE } from './lang.js';

const req = (headers: Record<string, string>) => ({ headers });

describe('langFor', () => {
  it('falls back to what the browser asked for', () => {
    expect(langFor(req({ 'accept-language': 'en-GB,en;q=0.9' }))).toBe('en');
    expect(langFor(req({ 'accept-language': 'zh-CN,zh;q=0.9' }))).toBe('zh');
  });

  it('lets a remembered choice win over the browser', () => {
    expect(langFor(req({ 'accept-language': 'zh-CN', cookie: `${LANG_COOKIE}=en` }))).toBe('en');
    expect(langFor(req({ 'accept-language': 'en-US', cookie: `${LANG_COOKIE}=zh` }))).toBe('zh');
  });

  it('ignores a cookie that says something else', () => {
    expect(langFor(req({ 'accept-language': 'en', cookie: `${LANG_COOKIE}=fr; other=1` }))).toBe(
      'en',
    );
  });
});

// The kiosk pages write this cookie from inlined JS in the renderer, which
// cannot import the constant. If the two names ever drift apart, walking from
// the dashboard into the kiosk silently switches language again.
it('kiosk pages write the same cookie this module reads', () => {
  expect(generateKioskShellHtml({ picker: { endpoint: '/api/run' } })).toContain(
    `${LANG_COOKIE}=`,
  );
});
