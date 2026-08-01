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
    generic: '通用说明:这段讲的是这类结构，不是专门写这个天体的',
    statusTitle: '这一屏的状态(仅工作人员可见)',
    genericHelp: '带 ※ 的条目用的是该类结构的通用说明，还没有专门为这个天体写的文字。',
    langBtn: 'EN',
    styleLabel: '讲解风格',
    no_annotations: '这张图已经认出目标，但标注库里还没有它的标注。',
    generic_only: '下面是这类结构的通用说明，还没有针对这个目标写的解读。',
    unsolved: '这张图没能解析出天区，所以下面不做任何身份判断。',
  },
  en: {
    tapHint: 'Tap a circle to find out what it is',
    back: 'Back',
    generic: 'General note: about this kind of structure, not written for this object',
    statusTitle: 'Status of this screen (for staff)',
    genericHelp: 'Items marked ※ use the general note for that kind of structure — nothing specific to this object has been written yet.',
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

  // An accordion, not a swap: every label is listed by title, and tapping one —
  // on the picture or in the list — opens that one. A visitor can see at a
  // glance how much there is to look at, which a one-card-at-a-time panel hides.
  const cards = report.features
    .map((f) => {
      const c = COLOR_PALETTE[f.color_key];
      const body = paragraphs(f, lang)
        .map((p) => `<p>${esc(p)}</p>`)
        .join('');
      // A quiet reference mark rather than a labelled tag: an audience should
      // not be reading provenance chatter, but a curator can see at a glance
      // which entries still need writing.
      const generic =
        sources[f.id] === 'feature_generic' || sources[f.id] === 'facts'
          ? `<span class="k-gen" title="${esc(UI[lang].generic)}">※</span>`
          : '';
      return `<article class="k-card" data-f="${esc(f.id)}">
  <button class="k-card-head" data-f="${esc(f.id)}">
    <span class="k-dot" style="background:${c.badge}">${esc(f.badge.num)}</span>
    <span class="k-card-title">${esc(f.label[lang])}</span>${generic}
    <span class="k-chev" aria-hidden="true"></span>
  </button>
  <div class="k-card-body">${body}</div>
</article>`;
    })
    .join('\n');

  const extras = report.extra_facts
    .map((e) => `<p class="k-extra">${esc(e[lang])}</p>`)
    .join('');

  // Not a banner. The status matters to whoever is running the screen, not to
  // the person reading it, so it lives as a corner dot that explains itself.
  // Staff-only. Hidden until tapped, and it carries everything an operator
  // might wonder about this frame — including what the ※ marks mean — so none
  // of that has to appear where an audience will read it and ask questions.
  const anyGeneric = report.features.some(
    (f) => sources[f.id] === 'feature_generic' || sources[f.id] === 'facts',
  );
  // Each line carries its own pair of languages, so the switcher's generic
  // textContent swap works on it. Handing the whole popover one multi-line
  // string instead collapsed the paragraphs into a single text node with a
  // literal newline in it, which renders as one run-on line.
  const notes: { zh: string; en: string }[] = [
    ...(state === 'ok' ? [] : [{ zh: UI.zh[state], en: UI.en[state] }]),
    ...(anyGeneric ? [{ zh: UI.zh.genericHelp, en: UI.en.genericHelp }] : []),
  ];
  const info = notes.length
    ? `<button id="k-info" aria-label="status" title="${esc(UI[lang].statusTitle)}">i</button>
<div id="k-note">${notes
        .map((n) => `<p data-zh="${esc(n.zh)}" data-en="${esc(n.en)}">${esc(n[lang])}</p>`)
        .join('')}</div>`
    : '';

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
/* A fixed two-pane split: picture on one side, words on the other, neither
   moving when something is tapped. An earlier version sized the image down to
   make room for a sliding panel; watching it, the movement was the problem —
   the picture an audience is reading jumps every time somebody touches a label.
   Nothing here animates except the text swap. */
#k{position:fixed;inset:0;display:flex;align-items:stretch;}
#k-view{flex:1 1 auto;min-width:0;position:relative;display:flex;
  align-items:center;justify-content:center;padding:12px;}
/* The overlay is a 100%×100% SVG over the stage, so the stage box must have the
   image's exact proportions — otherwise every circle renders as an ellipse.
   Width + aspect-ratio only: an explicit height as well would override the
   ratio, letterboxing the photo inside a taller box and leaving the overlay
   floating off the picture. */
#k-stage{position:relative;aspect-ratio:${width}/${height};width:100%;
  max-width:calc((100vh - 24px) * ${width} / ${height});max-height:100%;line-height:0;}
#k-stage img{width:100%;height:100%;display:block;object-fit:contain;}
#k-svg{position:absolute;inset:0;width:100%;height:100%;}
.k-feat{cursor:pointer;}
.k-feat .k-mark{opacity:.75;transition:opacity .2s;}
.k-feat .k-badge{transition:transform .2s;transform-origin:center;transform-box:fill-box;}
.k-feat.active .k-mark,.k-feat:focus .k-mark{opacity:1;}
.k-feat.active .k-badge{transform:scale(1.18);}
.k-feat:focus{outline:none;}
/* The first touch has to be invited — a ring on a dark photo reads as decoration. */
#k-hint{position:absolute;left:50%;bottom:3%;transform:translateX(-50%);
  padding:12px 24px;border-radius:999px;background:rgba(10,14,22,.82);
  border:1px solid #2a3346;color:#e6e9f0;font-size:clamp(14px,1.8vw,20px);
  line-height:1;white-space:nowrap;animation:k-pulse 2.6s ease-in-out infinite;}
@keyframes k-pulse{0%,100%{opacity:.55;}50%{opacity:1;}}
#k-hint.gone{display:none;}

/* The reading pane. Always there, always the same width. */
/* Drag the divider to rebalance picture vs words — a wide widefield wants more
   room than a small planetary, and that judgement belongs to whoever is
   presenting, not to a number baked in here. */
#k-split{flex:0 0 6px;cursor:col-resize;background:#161c28;position:relative;}
#k-split::after{content:'';position:absolute;inset:0 -5px;}
#k-split:hover{background:#28324a;}
#k-panel{flex:0 0 min(460px,38vw);min-width:220px;display:flex;flex-direction:column;
  background:#090c13;color:#e6e9f0;}
#k-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:14px 22px;border-bottom:1px solid #1b2231;}
#k-head button,.k-style{background:#141925;border:1px solid #2a3346;color:#cfd6e4;
  border-radius:9px;padding:8px 14px;font-size:14px;cursor:pointer;}
#k-head button:hover{background:#1c2333;}
.k-style{display:flex;gap:8px;align-items:center;font-size:13px;color:#8a93a8;padding:6px 10px;}
.k-style select{background:transparent;border:0;color:#cfd6e4;font-size:14px;}
#k-body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:22px 22px 40px;}
#k-title{font-size:clamp(20px,2.4vw,30px);font-weight:700;line-height:1.25;}
#k-narr{margin-top:10px;color:#c3cbdb;font-size:clamp(14px,1.5vw,18px);line-height:1.75;}
.k-extra{margin-top:12px;color:#93a0b8;font-size:clamp(13px,1.3vw,16px);line-height:1.7;
  padding-left:12px;border-left:2px solid #2a3346;}
/* Accordion: titles always visible, one body open at a time. */
.k-card{border-top:1px solid #1b2231;}
.k-card-head{display:flex;align-items:center;gap:10px;width:100%;padding:14px 2px;
  background:none;border:0;color:#e6e9f0;text-align:left;cursor:pointer;font:inherit;}
.k-card-head:hover{color:#fff;}
.k-card-title{flex:1 1 auto;font-size:clamp(15px,1.7vw,20px);font-weight:600;line-height:1.35;}
.k-dot{flex:0 0 auto;width:30px;height:30px;border-radius:50%;color:#0b0e14;
  font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;}
.k-gen{flex:0 0 auto;color:#5d6780;font-size:14px;cursor:help;}
.k-chev{flex:0 0 auto;width:9px;height:9px;border-right:2px solid #5d6780;
  border-bottom:2px solid #5d6780;transform:rotate(-45deg);transition:transform .18s;}
.k-card.open .k-chev{transform:rotate(45deg);}
.k-card-body{display:none;padding:0 2px 16px;}
.k-card.open .k-card-body{display:block;}
.k-card-body p{margin-top:10px;font-size:clamp(14px,1.5vw,18px);line-height:1.8;color:#ccd4e3;}
.k-card-body p:first-child{margin-top:0;}

/* Status is for the operator, not the audience: a quiet dot in the corner that
   explains itself when tapped, rather than a banner across the top of the
   reading. It only exists at all when something is less than complete. */
#k-info{position:absolute;right:14px;bottom:12px;width:26px;height:26px;
  border-radius:50%;border:1px solid #39415a;background:rgba(10,14,22,.7);
  color:#8a93a8;font-size:14px;font-style:italic;font-weight:700;line-height:24px;
  text-align:center;cursor:pointer;padding:0;}
#k-info:hover{color:#cfd6e4;}
#k-note{position:absolute;right:14px;bottom:46px;max-width:min(440px,70vw);
  display:none;padding:12px 14px;border-radius:10px;background:rgba(18,22,32,.97);
  border:1px solid #2a3346;color:#c3cbdb;font-size:14px;line-height:1.6;text-align:left;}
#k-note.show{display:block;}
#k-note p+p{margin-top:8px;}

@media (max-width:820px){
  #k{flex-direction:column;}
  #k-view{flex:0 0 52vh;padding:8px;}
  #k-stage{max-width:100%;max-height:100%;
    width:min(100%, calc((52vh - 16px) * ${width} / ${height}));}
  #k-panel{flex:1 1 auto;}
  #k-split{flex:0 0 6px;cursor:row-resize;}
}
</style>
</head>
<body>
<div id="k">
  <div id="k-view">
    <div id="k-stage">
      <img src="${opts.imageDataUri}" alt="${esc(report.object.name[lang])}">
      <svg id="k-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
${overlay}
      </svg>
      <div id="k-hint" data-zh="${esc(UI.zh.tapHint)}" data-en="${esc(UI.en.tapHint)}">${esc(UI[lang].tapHint)}</div>
    </div>
    ${info}
  </div>
  <div id="k-split" role="separator" aria-orientation="vertical"></div>
  <aside id="k-panel">
    <div id="k-head">
      <button id="k-lang" data-zh="${esc(UI.zh.langBtn)}" data-en="${esc(UI.en.langBtn)}">${esc(UI[lang].langBtn)}</button>
      ${styleSwitch}
    </div>
    <div id="k-body">
      <div id="k-intro">
        <h1 id="k-title" data-zh="${esc(report.object.name.zh)}" data-en="${esc(report.object.name.en)}">${esc(report.object.name[lang])}</h1>
        <p id="k-narr" data-zh="${esc(report.narrative.zh)}" data-en="${esc(report.narrative.en)}">${esc(report.narrative[lang])}</p>
        ${extras}
      </div>
${cards}
    </div>
  </aside>
</div>
<script>
(function(){
  var LANG=${JSON.stringify(lang)};
  var TEXT=${JSON.stringify(i18nData)};
  var IDLE=${idle};
  var hint=document.getElementById('k-hint');
  var panelEl=document.getElementById('k-panel');
  var body=document.getElementById('k-body');
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
      var on = c.getAttribute('data-f')===id;
      c.classList.toggle('open', on);
      // Bring the opened entry into view: on a long list the one you tapped on
      // the picture can easily be below the fold.
      if(on) c.scrollIntoView({block:'nearest',behavior:'smooth'});
    });
    if(id) hint.classList.add('gone');
    idleReset();
  }

  document.querySelectorAll('.k-feat').forEach(function(g){
    var id=g.getAttribute('data-f');
    function pick(e){ e.preventDefault(); e.stopPropagation(); show(active===id?null:id); }
    g.addEventListener('click', pick);
    g.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' ') pick(e); });
  });
  // Tapping a title toggles it, so the list works on its own without the picture.
  document.querySelectorAll('.k-card-head').forEach(function(h){
    h.addEventListener('click', function(){
      var id=h.getAttribute('data-f');
      show(active===id ? null : id);
    });
  });
  document.getElementById('k-stage').addEventListener('click', function(){ show(null); });

  // Draggable divider. Pointer events cover mouse and touch in one path.
  var split=document.getElementById('k-split');
  var wrap=document.getElementById('k');
  split.addEventListener('pointerdown', function(e){
    e.preventDefault();
    split.setPointerCapture(e.pointerId);
    var vertical = wrap.clientWidth > wrap.clientHeight * 1.1;
    function move(ev){
      var r=wrap.getBoundingClientRect();
      if(vertical){
        var w=Math.min(r.width-260, Math.max(220, r.right-ev.clientX));
        panelEl.style.flex='0 0 '+Math.round(w)+'px';
      } else {
        var h=Math.min(r.height-160, Math.max(160, r.bottom-ev.clientY));
        panelEl.style.flex='0 0 '+Math.round(h)+'px';
      }
      idleReset();
    }
    function up(){
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
    }
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  });

  // The status dot: quiet until asked.
  var infoBtn=document.getElementById('k-info');
  var note=document.getElementById('k-note');
  if(infoBtn && note){
    infoBtn.addEventListener('click', function(e){
      e.stopPropagation();
      note.classList.toggle('show');
      idleReset();
    });
    document.addEventListener('click', function(){ note.classList.remove('show'); });
  }

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
      // Target the accordion's own nodes. These paragraphs can't carry
      // data-zh/data-en like the rest of the page does, because a body may
      // split into a different number of paragraphs per language.
      var title=card.querySelector('.k-card-title');
      if(title) title.textContent=t[LANG].label;
      var bodyEl=card.querySelector('.k-card-body');
      if(!bodyEl) return;
      bodyEl.textContent='';
      t[LANG].body.forEach(function(s){
        var p=document.createElement('p'); p.textContent=s; bodyEl.appendChild(p);
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
