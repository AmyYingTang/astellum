import { COLOR_PALETTE, type Feature, type Reading } from '@astrolens/schema';

/**
 * The onsite display: one fullscreen frame an audience touches.
 *
 * It is the embed's sibling, not its replacement — the embed is a widget you
 * drop into a page, this is the whole screen in a museum or at a star party.
 * The differences are all about who is standing in front of it:
 *
 *  - **Touch, not hover.** Every label carries an invisible oversized hit area,
 *    because a teenager's fingertip is nothing like a mouse cursor.
 *  - **It invites the first touch.** A dark frame with rings on it does not read
 *    as interactive; a pulsing hint does.
 *  - **It resets itself.** Visitors walk away mid-read. After a quiet spell the
 *    panel closes so the next person starts from the top.
 *  - **It is honest about where the words came from.** Text that is a generic
 *    type-level note is labelled as one, never passed off as being about this
 *    particular object.
 *  - **It degrades on screen, not in a log.** A failed solve still shows the
 *    picture and whatever is known, with a plain-language line about the rest.
 */

function paragraphs(f: Feature, lang: 'zh' | 'en'): string[] {
  return [f.explanation[lang], f.physics?.[lang], f.interesting?.[lang]]
    .filter((s): s is string => !!s)
    .join('\n\n')
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** How complete the frame is. Each one means something different to the operator
 *  and needs a different sentence for the audience. */
export type KioskState =
  | 'ok' // solved, target in the atlas, text written
  | 'no_annotations' // solved and identified, but nothing drawn for it yet
  | 'generic_only' // drawn, but no target-level text — all generic notes
  | 'unsolved'; // plate solve failed: show the picture, claim nothing

export interface KioskOptions {
  /** data: URI of the image, so the page is one portable file. */
  imageDataUri: string;
  /** Feature id → which fallback layer wrote its text (from the reader). */
  textSources?: Record<string, string>;
  /** Overall completeness; drives the banner. Default 'ok'. */
  state?: KioskState;
  /** Styles the operator can switch between live (D6). Needs a server. */
  styles?: string[];
  currentStyle?: string;
  /** Close the panel after this many idle seconds. 0 disables. Default 120. */
  idleResetSec?: number;
}

const UI = {
  zh: {
    tapHint: '点一下圆圈，看看那是什么',
    back: '返回',
    generic: '通用说明',
    langBtn: 'EN',
    styleLabel: '讲解风格',
    no_annotations: '这张图已经认出目标，但标注库里还没有它的标注。',
    generic_only: '下面是这类结构的通用说明，还没有针对这个目标写的解读。',
    unsolved: '这张图没能解析出天区，所以下面不做任何身份判断。',
  },
  en: {
    tapHint: 'Tap a circle to find out what it is',
    back: 'Back',
    generic: 'General note',
    langBtn: '中文',
    styleLabel: 'Style',
    no_annotations: 'The target is identified, but nothing has been annotated for it yet.',
    generic_only: 'These are general notes for this kind of structure — nothing specific to this object yet.',
    unsolved: 'This image could not be plate-solved, so no identity is claimed below.',
  },
} as const;

/** Build the fullscreen, touch-first kiosk page for a reading. */
export function generateKioskHtml(report: Reading, opts: KioskOptions): string {
  const { width, height } = report.image;
  const lang = report.display_language;
  const state = opts.state ?? 'ok';
  const idle = opts.idleResetSec ?? 120;
  const sources = opts.textSources ?? {};
  // Rings and badges scale with the image, not the screen, since the SVG is
  // projected over it — but everything is sized generously for arm's length.
  const strokeW = Math.max(3, Math.round(Math.min(width, height) / 260));
  const hitR = Math.round(Math.min(width, height) / 22); // minimum touch target

  const overlay = report.features
    .filter((f) => f.draw !== false)
    .map((f) => {
      const c = COLOR_PALETTE[f.color_key];
      const { cx, cy, r } = f.circle;
      // Keep the badge at its authored radius: spreadBadges() already solved the
      // overlaps for exactly this size, and inflating it here silently undoes
      // that work (badges start covering each other). Reach is added below with
      // an invisible hit circle instead, which costs the layout nothing.
      const bR = f.badge.bubble_r;
      const bx = cx + (r + bR) * 0.7071 + f.badge.offset_x;
      const by = cy - (r + bR) * 0.7071 + f.badge.offset_y;
      const shape =
        f.shape === 'polygon' && f.polygon?.length
          ? `<polygon class="k-mark" points="${f.polygon.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c.stroke}" stroke-width="${strokeW}"/>`
          : f.shape === 'polyline' && f.polygon?.length
            ? `<polyline class="k-mark" points="${f.polygon.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c.stroke}" stroke-width="${strokeW}"/>`
            : `<circle class="k-mark" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.stroke}" stroke-width="${strokeW}"/>`;
      return `<g class="k-feat" data-f="${esc(f.id)}" tabindex="0" role="button">
  ${shape}
  <circle class="k-badge" cx="${bx}" cy="${by}" r="${bR}" fill="${c.badge}" stroke="#0b0e14" stroke-width="${Math.max(1, strokeW / 2)}"/>
  <text x="${bx}" y="${by}" font-size="${bR * 1.15}" font-weight="700" fill="#0b0e14" text-anchor="middle" dominant-baseline="central">${esc(f.badge.num)}</text>
  <circle class="k-hit" cx="${bx}" cy="${by}" r="${Math.max(hitR, bR * 2)}" fill="transparent"/>
</g>`;
    })
    .join('\n');

  const cards = report.features
    .map((f) => {
      const c = COLOR_PALETTE[f.color_key];
      const body = paragraphs(f, lang)
        .map((p) => `<p>${esc(p)}</p>`)
        .join('');
      const generic =
        sources[f.id] === 'feature_generic' || sources[f.id] === 'facts'
          ? `<span class="k-tag">${esc(UI[lang].generic)}</span>`
          : '';
      return `<article class="k-card" data-f="${esc(f.id)}">
  <header><span class="k-dot" style="background:${c.badge}">${esc(f.badge.num)}</span>
  <h2>${esc(f.label[lang])}</h2>${generic}</header>
  ${body}
</article>`;
    })
    .join('\n');

  const extras = report.extra_facts
    .map((e) => `<p class="k-extra">${esc(e[lang])}</p>`)
    .join('');

  const banner =
    state === 'ok'
      ? ''
      : `<div class="k-banner" data-zh="${esc(UI.zh[state])}" data-en="${esc(UI.en[state])}">${esc(UI[lang][state])}</div>`;

  const styleSwitch =
    opts.styles && opts.styles.length > 1
      ? `<label class="k-style">${esc(UI[lang].styleLabel)}
  <select id="k-style-sel">${opts.styles
    .map(
      (s) =>
        `<option value="${esc(s)}"${s === opts.currentStyle ? ' selected' : ''}>${esc(s)}</option>`,
    )
    .join('')}</select></label>`
      : '';

  // Both languages ship in the page, so the switch is instant and works offline.
  const i18nData = report.features
    .map((f) => ({
      id: f.id,
      zh: { label: f.label.zh, body: paragraphs(f, 'zh') },
      en: { label: f.label.en, body: paragraphs(f, 'en') },
    }))
    .concat();

  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>${esc(report.object.name[lang])} — astrolens</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;overflow:hidden;background:#05070c;
  font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-tap-highlight-color:transparent;user-select:none;}
/* The panel must not cover what was just tapped — you touch a thing and the
   thing vanishes behind the text about it. Reserve the panel's space instead,
   so the image shrinks aside and the tapped label stays in view. */
#k{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  transition:padding .28s cubic-bezier(.22,.61,.36,1);}
body.k-open #k{padding-right:min(460px,92vw);}
/* The overlay is a 100%×100% SVG over the stage, so the stage box must have the
   image's exact proportions — otherwise every circle renders as an ellipse.
   Pin it with aspect-ratio rather than letting the img size the box.
   Set width + aspect-ratio only: giving it an explicit height as well would
   override the ratio, and the moment the panel narrows the container the box
   would keep its full height while the photo letterboxed inside it — leaving
   the overlay floating off the picture. */
#k-stage{position:relative;aspect-ratio:${width}/${height};width:100%;
  max-width:calc(100vh * ${width} / ${height});max-height:100%;line-height:0;}
#k-stage img{width:100%;height:100%;display:block;object-fit:contain;}
#k-svg{position:absolute;inset:0;width:100%;height:100%;}
.k-feat{cursor:pointer;}
.k-feat .k-mark{opacity:.75;transition:opacity .2s;}
.k-feat .k-badge{transition:transform .2s;transform-origin:center;transform-box:fill-box;}
.k-feat.active .k-mark,.k-feat:focus .k-mark{opacity:1;}
.k-feat.active .k-badge{transform:scale(1.18);}
.k-feat:focus{outline:none;}
/* The first touch has to be invited — a ring on a dark photo reads as decoration. */
#k-hint{position:absolute;left:50%;bottom:5%;transform:translateX(-50%);
  padding:14px 26px;border-radius:999px;background:rgba(10,14,22,.82);
  border:1px solid #2a3346;color:#e6e9f0;font-size:clamp(15px,2.1vw,22px);
  line-height:1;white-space:nowrap;animation:k-pulse 2.6s ease-in-out infinite;}
@keyframes k-pulse{0%,100%{opacity:.55;}50%{opacity:1;}}
#k-hint.gone{display:none;}
#k-panel{position:fixed;right:0;top:0;bottom:0;width:min(460px,92vw);
  background:rgba(9,12,19,.96);border-left:1px solid #232c3d;color:#e6e9f0;
  transform:translateX(100%);transition:transform .28s cubic-bezier(.22,.61,.36,1);
  overflow-y:auto;-webkit-overflow-scrolling:touch;padding:26px 24px 40px;z-index:10;}
#k-panel.open{transform:none;}
#k-title{font-size:clamp(20px,2.6vw,30px);font-weight:700;line-height:1.25;}
#k-narr{margin-top:10px;color:#c3cbdb;font-size:clamp(14px,1.6vw,18px);line-height:1.75;}
.k-extra{margin-top:12px;color:#93a0b8;font-size:clamp(13px,1.4vw,16px);line-height:1.7;
  padding-left:12px;border-left:2px solid #2a3346;}
.k-card{display:none;}
.k-card.show{display:block;}
.k-card header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;}
.k-card h2{font-size:clamp(18px,2.2vw,26px);font-weight:700;}
.k-dot{flex:0 0 auto;width:34px;height:34px;border-radius:50%;color:#0b0e14;
  font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;}
.k-tag{font-size:12px;color:#8a93a8;border:1px solid #2a3346;border-radius:999px;padding:3px 9px;}
.k-card p{margin-top:12px;font-size:clamp(15px,1.7vw,19px);line-height:1.8;color:#ccd4e3;}
.k-banner{position:fixed;left:0;right:0;top:0;padding:12px 18px;z-index:20;
  background:rgba(60,44,12,.92);border-bottom:1px solid #6b5220;color:#f3e2bd;
  font-size:clamp(13px,1.5vw,17px);line-height:1.5;text-align:center;}
#k-bar{position:fixed;left:14px;top:14px;z-index:20;display:flex;gap:10px;align-items:center;}
#k-bar button,.k-style{background:rgba(10,14,22,.8);border:1px solid #2a3346;color:#cfd6e4;
  border-radius:10px;padding:10px 16px;font-size:15px;cursor:pointer;}
.k-style{display:flex;gap:8px;align-items:center;font-size:14px;color:#8a93a8;}
.k-style select{background:transparent;border:0;color:#cfd6e4;font-size:15px;}
#k-back{position:sticky;top:0;float:right;background:rgba(20,26,38,.9);border:1px solid #2a3346;
  color:#cfd6e4;border-radius:10px;padding:9px 16px;font-size:15px;cursor:pointer;}
@media (max-width:760px){
  #k-panel{width:100vw;top:auto;height:74vh;border-left:0;border-top:1px solid #232c3d;
    transform:translateY(100%);border-radius:18px 18px 0 0;}
  #k-panel.open{transform:none;}
  body.k-open #k{padding-right:0;padding-bottom:74vh;}
}
</style>
</head>
<body>
${banner}
<div id="k">
  <div id="k-stage">
    <img src="${opts.imageDataUri}" alt="${esc(report.object.name[lang])}">
    <svg id="k-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
${overlay}
    </svg>
    <div id="k-hint" data-zh="${esc(UI.zh.tapHint)}" data-en="${esc(UI.en.tapHint)}">${esc(UI[lang].tapHint)}</div>
  </div>
</div>
<div id="k-bar">
  <button id="k-lang" data-zh="${esc(UI.zh.langBtn)}" data-en="${esc(UI.en.langBtn)}">${esc(UI[lang].langBtn)}</button>
  ${styleSwitch}
</div>
<aside id="k-panel">
  <button id="k-back" data-zh="${esc(UI.zh.back)}" data-en="${esc(UI.en.back)}">${esc(UI[lang].back)}</button>
  <div id="k-intro">
    <h1 id="k-title" data-zh="${esc(report.object.name.zh)}" data-en="${esc(report.object.name.en)}">${esc(report.object.name[lang])}</h1>
    <p id="k-narr" data-zh="${esc(report.narrative.zh)}" data-en="${esc(report.narrative.en)}">${esc(report.narrative[lang])}</p>
    ${extras}
  </div>
${cards}
</aside>
<script>
(function(){
  var LANG=${JSON.stringify(lang)};
  var TEXT=${JSON.stringify(i18nData)};
  var IDLE=${idle};
  var panel=document.getElementById('k-panel');
  var hint=document.getElementById('k-hint');
  var intro=document.getElementById('k-intro');
  var timer=null, active=null;

  function idleReset(){
    if(!IDLE) return;
    clearTimeout(timer);
    timer=setTimeout(function(){ show(null); }, IDLE*1000);
  }

  function show(id){
    active=id;
    document.querySelectorAll('.k-feat').forEach(function(g){
      g.classList.toggle('active', g.getAttribute('data-f')===id);
    });
    document.querySelectorAll('.k-card').forEach(function(c){
      c.classList.toggle('show', c.getAttribute('data-f')===id);
    });
    intro.style.display = id ? 'none' : '';
    panel.classList.toggle('open', !!id);
    document.body.classList.toggle('k-open', !!id);
    panel.scrollTop=0;
    if(id) hint.classList.add('gone');
    idleReset();
  }

  document.querySelectorAll('.k-feat').forEach(function(g){
    var id=g.getAttribute('data-f');
    function pick(e){ e.preventDefault(); e.stopPropagation(); show(active===id?null:id); }
    g.addEventListener('click', pick);
    g.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' ') pick(e); });
  });
  document.getElementById('k-back').addEventListener('click', function(){ show(null); });
  document.getElementById('k-stage').addEventListener('click', function(){ show(null); });

  // Both languages are already in the page, so this never needs the network.
  document.getElementById('k-lang').addEventListener('click', function(){
    LANG = LANG==='zh' ? 'en' : 'zh';
    document.documentElement.lang=LANG;
    document.querySelectorAll('[data-zh]').forEach(function(el){
      el.textContent = el.getAttribute('data-'+LANG) || el.textContent;
    });
    TEXT.forEach(function(t){
      var card=document.querySelector('.k-card[data-f="'+t.id+'"]');
      if(!card) return;
      card.querySelector('h2').textContent=t[LANG].label;
      card.querySelectorAll('p').forEach(function(p){ p.remove(); });
      t[LANG].body.forEach(function(s){
        var p=document.createElement('p'); p.textContent=s; card.appendChild(p);
      });
    });
    idleReset();
  });

  var sel=document.getElementById('k-style-sel');
  if(sel) sel.addEventListener('change', function(){
    // Styles are rendered server-side; reload with the chosen one.
    var u=new URL(location.href); u.searchParams.set('style', sel.value); location.href=u.toString();
  });

  ['pointerdown','keydown'].forEach(function(ev){
    document.addEventListener(ev, idleReset, {passive:true});
  });
  idleReset();
})();
</script>
</body>
</html>`;
}
