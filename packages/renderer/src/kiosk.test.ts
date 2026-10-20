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
// The number alone makes the viewer carry "4" over to the list and hunt for it.
describe('overlay names', () => {
  it('writes each feature\u2019s name beside its number, in both languages', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('class="k-label"');
    expect(html).toContain('data-zh="a" data-en="a"');
  });

  it('draws the number smaller than the radius the layout was solved for', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    const drawn = /class="k-badge"[^>]*r="([\d.]+)"/.exec(html)?.[1];
    expect(Number(drawn)).toBeLessThan(report.features[0]!.badge.bubble_r);
  });
});

// What a reader ran into: the mark was the only target, and a pillar is a few
// dozen pixels on a wide frame.
describe('proximity and the magnified crop', () => {
  // Making the structures sensitive read well and worked badly: the ring around
  // a whole nebula passes close to half the other marks, so standing anywhere
  // near its rim beat every one of them.
  it('keeps the structure as geometry for the crop, not as a target', () => {
    const poly = {
      ...report,
      features: [{ ...report.features[0]!, shape: 'polygon' as const, polygon: [[10, 10], [90, 10], [90, 90]] as [number, number][] }],
    };
    const html = generateKioskHtml(poly, { imageDataUri: 'data:...' });
    expect(html).toContain('<polygon class="k-geo"');
    expect(html).toMatch(/\.k-geo\{pointer-events:none/);
  });

  it('measures the pointer against the number and the name', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/function at\(x, y\)\{[\s\S]*?e\.badge\.getBoundingClientRect/);
    expect(html).toMatch(/function at\(x, y\)\{[\s\S]*?e\.label\.getBoundingClientRect/);
  });

  // Slack in image pixels is slack that shrinks as the picture gets bigger;
  // what has to stay the same is the gap under somebody's finger.
  it('measures that slack in screen pixels', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/var REACH=\d+;/);
    expect(html).not.toMatch(/REACH\*\(box\.width\/IMG_W\)/);
  });

  // Filling a ring that spans half the frame would make one hotspot that
  // swallows every mark inside it.
  // The crop's mask reads this: a ring was never a filled region, so its lit
  // part is the rim, not the whole disc it encloses.
  it('leaves a large ring hollow and fills only a small marker', () => {
    const big = { ...report, features: [{ ...report.features[0]!, circle: { cx: 500, cy: 400, r: 300 } }] };
    const small = { ...report, features: [{ ...report.features[0]!, circle: { cx: 500, cy: 400, r: 20 } }] };
    expect(generateKioskHtml(big, { imageDataUri: 'd' })).toMatch(/k-geo[^>]*fill="none"/);
    expect(generateKioskHtml(small, { imageDataUri: 'd' })).toMatch(/k-geo[^>]*cx="500"[^>]*fill="transparent"/);
  });

  it('ships a crop box per feature, floored so a marker is not a pinhole', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    const crops = /var CROPS=(\[.*?\]);/.exec(html)?.[1];
    expect(crops).toBeTruthy();
    const parsed = JSON.parse(crops!) as { half: number }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.half).toBeGreaterThanOrEqual(800 / 25 / 2);
  });

  it('keeps the crop from swallowing the pointer it is hit-tested with', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/#k-loupe\{[^}]*pointer-events:none/);
  });

  it('leaves the picture unmarked until something is being read', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/\.k-feat \.k-mark\{opacity:0/);
  });
});

describe('name plates', () => {
  it('puts the name on a plate whose colour owes nothing to the feature', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('<rect class="k-plate"');
    expect(html).toContain('fill="#f2f5fb"'); // one text colour for every label
  });

  // The language switch assigns textContent; on the group it would take the
  // plate with it.
  it('keeps the translation on the text, not on the group holding the plate', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/<g class="k-label"><rect class="k-plate"[^>]*\/><text[^>]*data-zh=/);
  });
});

// Opaque plates do not merely crowd each other, they cover each other and the
// picture under them.
// The crop says which part it means with light and shade rather than a drawn
// line, and a line — having no inside — is given one.
describe('the invitation', () => {
  it('describes coming near, which is what the screen now responds to', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('Come near any mark');
    expect(html).not.toContain('Tap a circle');
  });

  // Someone walking up mid-session must still be told how this works.
  it('stays on screen once the frame has been used, only quieter', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).not.toMatch(/#k-hint\.gone\{display:none/);
    expect(html).toMatch(/#k-hint\.quiet\{animation:none/);
  });
});

describe('the magnified crop', () => {
  it('dims around the region instead of outlining it', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('<mask id="');
    expect(html).toMatch(/fill="rgba\(3,5,10,\.66\)" mask=/);
  });

  it('gives an open line a band to stand for its inside', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toMatch(/band=Math\.max\(6/);
  });

  it('goes to the corner across the picture from its subject', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/fx < box\.width\/2 \? box\.width-side-m : m/);
  });

  it('lingers after the pointer leaves, then gets out of the way', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/var LINGER=\d{4}/);
    expect(html).toContain("addEventListener('pointerleave'");
  });
});

describe('crowded names', () => {
  it('lays the plates out and can drop one that has nowhere to go', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('function layoutLabels()');
    expect(html).toMatch(/\.k-label\.crowded\{opacity:0/);
  });

  it('brings a dropped name back when its feature is the one being read', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/\.k-feat\.active \.k-label\.crowded\{opacity:1/);
  });
});

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
