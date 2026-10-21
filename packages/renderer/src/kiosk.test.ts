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

  it('keeps the crop off the picture entirely, so it cannot shadow the pointer', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).not.toContain('k-loupe');
    expect(html).toContain('id="k-crop"');   // it lives in the panel now
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

// A reader saw "a shadow" over the dust lane: it was a neighbour's plate,
// faded as a whole and still reading as a grey slab on the photograph.
// The Carina Nebula is 3½° across and the picture covers under three: the
// frame is a crop of it, so there is no boundary here to draw.
// Both reported from a real frame: a dust lane came up with a dark stripe down
// its middle, and Carina's crop came up black.
describe('what the crop lights', () => {
  it('treats an outline that all but closes as the region it encloses', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('function nearlyClosed(pts)');
    expect(html).toMatch(/\(geo\.closed \|\| nearlyClosed\(geo\.pts\)\)/);
  });

  it('shows no crop for a subject with no region of its own', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/var hasShape = geo && \(geo\.pts \|\| geo\.r!==undefined\)/);
  });
});

describe('a subject wider than the frame', () => {
  it('draws no ring and offers nothing to come near', () => {
    const field = {
      ...report,
      features: [{ ...report.features[0]!, shape: 'field' as const }],
    };
    const html = generateKioskHtml(field, { imageDataUri: 'data:...' });
    expect(html).not.toContain('class="k-mark"');
    expect(html).not.toContain('class="k-geo"');
  });

  it('keeps its number and its name', () => {
    const field = {
      ...report,
      features: [{ ...report.features[0]!, shape: 'field' as const }],
    };
    const html = generateKioskHtml(field, { imageDataUri: 'data:...' });
    expect(html).toContain('class="k-badge"');
    expect(html).toContain('class="k-label"');
  });
});

describe('faded names', () => {
  it('fades the slab harder than the word standing on it', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    const group = /#k-svg\.has-active \.k-feat:not\(\.active\) \.k-label\{opacity:([\d.]+)/.exec(html)?.[1];
    const plate = /#k-svg\.has-active \.k-feat:not\(\.active\) \.k-plate\{opacity:([\d.]+)/.exec(html)?.[1];
    expect(Number(plate)).toBeLessThan(Number(group));
    // Opacity multiplies down the tree, so what lands on the picture is tiny.
    expect(Number(plate) * Number(group)).toBeLessThan(0.1);
  });
});

describe('the magnified crop', () => {
  it('dims around the region instead of outlining it', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('<mask id="');
    // Held back, not blacked out: the crop is a piece of a photograph, and the
    // sky around the named thing is what makes the naming mean anything.
    expect(html).toMatch(/fill="rgba\(3,5,10,\.4\)" mask=/);
  });

  it('gives an open line a band to stand for its inside', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toMatch(/band=Math\.max\(6/);
  });

  // A panel that opens full of text asks to be read before anyone has pointed
  // at anything.
  it('opens with nothing in the panel at all', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toMatch(/#k-read\{display:none/);
    expect(html).toMatch(/#k-all\{display:none/);
  });

  it('puts the whole list one row away rather than in the way', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...' });
    expect(html).toContain('id="k-all-head"');
    expect(html).toMatch(/#k-all-body\{display:none/);
    expect(html).toMatch(/#k-all\.open #k-all-body\{display:block/);
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

/**
 * Which question the picker asks is the whole of the offline/online choice:
 * pick from what somebody wrote, or describe the room and have it written.
 */
describe('picker: library styles vs an audience to write for', () => {
  const presets = [
    { id: 'kids', group: 'audience' as const, labelZh: '儿童', labelEn: 'Kids', textZh: '写给孩子', textEn: 'For children' },
    { id: 'art', group: 'focus' as const, labelZh: '艺术', labelEn: 'Artistic', textZh: '侧重艺术', textEn: 'Lean artistic' },
  ];

  it('offers the styles it was handed, not a single configured one', () => {
    const html = generateKioskShellHtml({ picker: { endpoint: '/api/run', styles: ['general', '诗意'] } });
    expect(html).toContain('id="k-pick-style"');
    expect(html).toContain('<option>诗意</option>');
  });

  // The server used to pass `[config.reading.style]`, which could never satisfy
  // this condition, so the select had never once appeared.
  it('leaves the style out when there is nothing to choose between', () => {
    expect(generateKioskShellHtml({ picker: { endpoint: '/api/run', styles: ['general'] } })).not.toContain(
      'id="k-pick-style"',
    );
  });

  it('asks who is in the room instead, when it writes on the night', () => {
    const html = generateKioskShellHtml({ picker: { endpoint: '/api/run', presets } });
    expect(html).toContain('class="k-chip"');
    expect(html).toContain('data-text-zh="写给孩子"'); // the sentence the model gets
    expect(html).toContain('id="k-pick-tone"'); // and room to add to it
    expect(html).toContain('tone:tone()'); // which the POST carries
  });

  it('never asks both — the two are the same question of different machines', () => {
    const html = generateKioskShellHtml({
      picker: { endpoint: '/api/run', styles: ['general', '诗意'], presets },
    });
    expect(html).toContain('class="k-chip"');
    expect(html).not.toContain('id="k-pick-style"');
  });

  it('says plainly what writing on the night costs', () => {
    const html = generateKioskShellHtml({ picker: { endpoint: '/api/run', presets }, lang: 'en' });
    expect(html).toContain('needs a network');
    expect(html).toContain('the model only changes the wording');
  });
});

describe('the poster control', () => {
  // It was offered on the empty shell too, where there is no frame to print,
  // and its menu — styled only by the frame page — sat open in the head.
  it('is not offered on a shell that has no frame yet', () => {
    const html = generateKioskShellHtml({ picker });
    expect(html).not.toContain('id="k-poster"');
    expect(html).not.toContain('data-layout="portrait"');
  });

  it('is offered on a frame, with its menu closed until asked', () => {
    const html = generateKioskHtml(report, { imageDataUri: 'data:...', picker });
    expect(html).toContain('id="k-poster"');
    expect(html).toContain('#k-poster-menu{display:none;');
  });

  /*
   * A template literal eats `\/`, so the source's `/\/$/` reached the browser
   * as `//$/` — a comment, and a syntax error that took the whole inline
   * script with it, including the picker's own listeners.
   */
  it('emits script the browser can parse', () => {
    const html = generateKioskShellHtml({ picker });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => new Function(s)).not.toThrow();
    for (const s of [...generateKioskHtml(report, { imageDataUri: 'data:...', picker })
      .matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) {
      expect(() => new Function(s)).not.toThrow();
    }
  });
});
