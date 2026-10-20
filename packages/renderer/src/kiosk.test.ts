import { describe, expect, it } from 'vitest';
import type { Reading } from '@astellum/schema';
import { generateKioskHtml, generateKioskShellHtml } from './kiosk.js';

const report = {
  version: '2.0',
  image: { src: 'image.jpg', width: 1000, height: 800 },
  display_language: 'zh',
  object: { name: { zh: '船底座星云', en: 'Carina Nebula' }, aliases: [], type: { zh: '发射星云', en: 'Emission nebula' } },
  narrative: { zh: '测试', en: 'test' },
  features: [
    {
      id: 'f1',
      fact_ref: null,
      label: { zh: 'a', en: 'a' },
      color_key: 'hot',
      circle: { cx: 500, cy: 400, r: 100 },
      badge: { num: '1', offset_x: 0, offset_y: 0, bubble_r: 30 },
      explanation: { zh: 'x', en: 'x' },
      needs_human_review: false,
    },
  ],
  extra_facts: [],
  created_at: '2026-05-27T00:00:00.000Z',
  generator: { tool: 'astellum', tool_version: '0.1.0', llm: 'claude' },
} satisfies Reading;

const picker = { endpoint: '/api/run' };

/**
 * The chrome is the page's only way out, and the one thing that must NOT appear
 * on the portable file:// page — there is no server behind it to answer a POST,
 * and no hub to go back to.
 */
describe('kiosk chrome', () => {
  it('omits both controls when nothing is passed', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:image/png;base64,AA' });
    expect(html).not.toContain('k-pick-btn');
    expect(html).not.toContain('← ASTELLUM');
  });

  it('adds the back link only when a hub URL is given', () => {
    const html = generateKioskHtml(report, {
      imageDataUri: 'data:image/png;base64,AA',
      hubUrl: 'http://localhost:3000/',
    });
    expect(html).toContain('href="http://localhost:3000/"');
    expect(html).toContain('← ASTELLUM');
    expect(html).not.toContain('k-pick-btn'); // no picker without one
  });

  it('adds the picker, pointed at the endpoint it was given', () => {
    const html = generateKioskHtml(report, {
      imageDataUri: 'data:image/png;base64,AA',
      picker: { endpoint: '/api/run', styles: ['科普', '诗意'] },
    });
    expect(html).toContain('id="k-pick-btn"');
    expect(html).toContain('"/api/run"');
    expect(html).toContain('<option>科普</option>');
  });

  // The language switch replaces textContent on everything carrying data-zh, so
  // a translated label must not also be the input's parent — doing that wiped
  // the field out of the form the first time the page was switched to English.
  it('keeps translated label text off the elements that hold inputs', () => {
    const html = generateKioskHtml(report, {
      imageDataUri: 'data:...',
      picker: { endpoint: '/api/run', styles: ['a', 'b'] },
    });
    for (const m of html.matchAll(/<label[^>]*data-zh[^>]*>([\s\S]*?)<\/label>/g)) {
      expect(m[1]).not.toMatch(/<(input|select)/);
    }
  });

  it('ships both languages for every control it draws', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...', picker });
    expect(html).toContain('data-zh="选择图片" data-en="Pick image"');
    expect(html).toContain('data-zh="开始" data-en="Start"');
  });
});

// A frame is a file: the language it was built in is frozen into it, while the
// operator may have switched theirs on another surface since. Both languages
// ship in the page, so it starts in whichever they chose last.
describe('frame language', () => {
  it('reads the shared cookie on load and flips to it', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('astellum_lang=(zh|en)');
    expect(html).toContain('applyLang(want)');
  });

  it('still bakes in the reading\u2019s own language, for a page with no cookie jar', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('<html lang="zh">');
  });
});

describe('kiosk shell', () => {
  it('carries the same chrome as a frame', () => {
    const html = generateKioskShellHtml({ hubUrl: 'http://localhost:3000/', picker });
    expect(html).toContain('← ASTELLUM');
    expect(html).toContain('id="k-pick-btn"');
    expect(html).toContain('id="k-lang"');
  });

  it('says where to start, in both languages', () => {
    const html = generateKioskShellHtml({ picker });
    expect(html).toContain('点右上角');
    expect(html).toContain('data-en="Pick an image, top right, to begin"');
  });

  it('opens in the language it was asked for', () => {
    expect(generateKioskShellHtml({ picker, lang: 'en' })).toContain('<html lang="en">');
  });
});
