import { describe, expect, it } from 'vitest';
import { preferredLang } from './index.js';

describe('starting UI language', () => {
  it('picks Chinese for any Chinese locale, however it is written', () => {
    for (const l of ['zh', 'zh-CN', 'zh-TW', 'zh-Hant-HK', 'ZH-cn']) {
      expect(preferredLang([l]), l).toBe('zh');
    }
  });

  it('picks English for everything else — the only other language it speaks', () => {
    expect(preferredLang(['en-GB'])).toBe('en');
    expect(preferredLang(['ja-JP', 'ko'])).toBe('en');
    expect(preferredLang([])).toBe('en');
  });

  it('honours a Chinese preference anywhere in the list', () => {
    expect(preferredLang(['en-US', 'zh-CN'])).toBe('zh');
  });
});
