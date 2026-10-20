import { COLOR_PALETTE, badgeAnchor, type Feature, type Reading } from '@astellum/schema';
import { overlayLabel } from './overlayLabel.js';

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

/**
 * The kiosk's icon, in the same family as the hub, studio and atlas ones: dark
 * sky, the accent blue, a couple of stars. Each shows what that surface *does* —
 * the atlas draws an outline, the studio points at an object, the hub is the
 * instrument. This one is a label being touched, which is the whole interaction.
 *
 * Exported so the kiosk's front door can serve the same mark; the generated page
 * inlines it as a data URI instead, because that page's defining property is
 * that it is one portable file.
 *
 * Careful: XML forbids a double hyphen inside a comment. One makes the file
 * unparseable and the browser silently shows nothing.
 */
export const KIOSK_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#141825"/>
  <circle cx="5.5" cy="5.5" r="1" fill="#c8d0e0" opacity=".5"/>
  <circle cx="27" cy="27" r="1" fill="#c8d0e0" opacity=".45"/>
  <rect x="5" y="8" width="22" height="15" rx="2.6" fill="#7aa2f7" fill-opacity=".16"
        stroke="#7aa2f7" stroke-width="2.1"/>
  <circle cx="13" cy="15.5" r="3.4" fill="none" stroke="#9ab8ff" stroke-width="1.8"/>
  <circle cx="20.5" cy="18.5" r="2.6" fill="#9ab8ff"/>
</svg>`;

/** The same mark, ready to drop into a `<link rel="icon">` in a standalone file. */
export const KIOSK_FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(KIOSK_FAVICON)}`;

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
  /** Where "← ASTELLUM" goes. Absolute, because the one-shot page is opened as
   *  a file:// URL where a relative one would point at the filesystem. Omitted
   *  when nothing launched this, exactly as the atlas and studio do. */
  hubUrl?: string;
  /** Picking a new image needs somewhere to POST it, so this is only set when a
   *  server is serving the page — never on the portable file:// one. */
  picker?: KioskPicker;
}

export interface KioskPicker {
  /** Endpoint that takes {filename, dataUrl, target, lang, style} and answers
   *  {ok, url} — the kiosk server's /api/run. */
  endpoint: string;
  /** Offered in the form when the library has more than one. */
  styles?: string[];
  /** Offline-catalogue state, already phrased; shown under the form. */
  offlineNote?: { zh: string; en: string };
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
    pick: '选择图片',
    pickTitle: '现场识别',
    pickSub: '选一张图,几秒后出一张可点的全屏页。支持 FITS(自动拉伸)、JPG、PNG、TIFF。',
    fileHint: '点这里选择图片…',
    targetLabel: '目标名(可选,填了识别更稳)',
    langLabel: '语言',
    start: '开始',
    reading: '读取文件…',
    solving: '解析中…(plate solve 可能要几十秒)',
    opening: '完成,正在打开…',
    failed: '识别失败',
    close: '关闭',
    emptyHint: '点右上角「选择图片」开始',
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
    pick: 'Pick image',
    pickTitle: 'Onsite reading',
    pickSub:
      'Choose an image and a fullscreen, touchable page appears in seconds. FITS (auto-stretched), JPG, PNG, TIFF.',
    fileHint: 'Choose an image…',
    targetLabel: 'Target name (optional — makes identification surer)',
    langLabel: 'Language',
    start: 'Start',
    reading: 'Reading the file…',
    solving: 'Working… (a plate solve can take a minute)',
    opening: 'Done — opening…',
    failed: 'Could not read this image',
    close: 'Close',
    emptyHint: 'Pick an image, top right, to begin',
    no_annotations: 'The target is identified, but nothing has been annotated for it yet.',
    generic_only: 'These are general notes for this kind of structure — nothing specific to this object yet.',
    unsolved: 'This image could not be plate-solved, so no identity is claimed below.',
  },
} as const;

/** How much of its authored radius the number is drawn at — see the overlay
 *  for why the drawn size and the layout size differ. */
const BADGE_SCALE = 0.7;

/** What the picker will take. Same set the kiosk itself can read. */
const PICK_ACCEPT = '.fits,.fit,.fts,.jpg,.jpeg,.png,.tif,.tiff';

/**
 * The page's own chrome: the way back to the hub, and the way to the next
 * frame. Shared by the reading page and the empty shell so there is one
 * definition of each.
 *
 * It is deliberately faint. The audience is looking at this screen, and a
 * visitor who taps "← ASTELLUM" out of curiosity has ended the session — so
 * the controls sit at a third opacity until you reach for them. Hover and
 * keyboard focus bring them up on a desk; on a touchscreen there is no hover,
 * so a touch anywhere in the head lights them for a few seconds instead.
 */
const CHROME_CSS = `
#k-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:14px 22px;border-bottom:1px solid #1b2231;}
#k-head button,.k-style{background:#141925;border:1px solid #2a3346;color:#cfd6e4;
  border-radius:9px;padding:8px 14px;font-size:14px;cursor:pointer;}
#k-head button:hover{background:#1c2333;}
.k-style{display:flex;gap:8px;align-items:center;font-size:13px;color:#8a93a8;padding:6px 10px;}
.k-style select{background:transparent;border:0;color:#cfd6e4;font-size:14px;}
.k-chrome{opacity:.32;transition:opacity .15s;}
.k-chrome:hover,.k-chrome:focus-visible,#k-head.lit .k-chrome{opacity:1;}
a.k-chrome{display:inline-block;color:#8a93a8;text-decoration:none;font-size:13px;
  padding:8px 12px;border:1px solid #2a3346;border-radius:9px;}
a.k-chrome:hover{color:#cfd6e4;border-color:#3a4a6b;}

/* The picker, as an overlay rather than a screen of its own: choosing the next
   image is a detour from the frame that is up, not a place you go. */
#k-pick-wrap{position:fixed;inset:0;z-index:20;display:none;padding:24px;
  align-items:center;justify-content:center;background:rgba(3,5,9,.74);}
#k-pick-wrap.show{display:flex;}
#k-pick{width:min(560px,100%);max-height:90vh;overflow-y:auto;background:#0b0f18;
  border:1px solid #1e2637;border-radius:16px;padding:30px;color:#e6e9f0;user-select:text;}
#k-pick h2{font-size:22px;font-weight:700;}
#k-pick .k-sub{margin-top:6px;color:#8a93a8;font-size:14px;line-height:1.6;}
#k-pick label{display:block;margin-top:20px;font-size:13px;color:#8a93a8;}
#k-pick input[type=text],#k-pick select{width:100%;margin-top:7px;background:#141925;
  border:1px solid #2a3346;color:#e6e9f0;border-radius:10px;padding:12px 14px;font-size:16px;}
#k-pick .k-file{margin-top:8px;display:block;border:1px dashed #2f3a52;border-radius:12px;
  padding:22px;text-align:center;color:#9aa4bb;cursor:pointer;font-size:15px;}
#k-pick .k-file:hover{border-color:#3f4d6b;color:#cfd6e4;}
#k-pick .k-file input{display:none;}
#k-pick .k-row{display:flex;gap:12px;}
#k-pick .k-row>*{flex:1 1 0;}
#k-pick .k-go{margin-top:24px;width:100%;background:#2b6cb0;border:0;color:#fff;
  border-radius:12px;padding:15px;font-size:17px;font-weight:600;cursor:pointer;}
#k-pick .k-go:disabled{background:#243447;color:#6b768f;cursor:default;}
#k-pick .k-status{margin-top:16px;font-size:13px;line-height:1.6;color:#8a93a8;min-height:20px;}
#k-pick .k-status.err{color:#f7768e;}
#k-pick .k-foot{margin-top:22px;padding-top:16px;border-top:1px solid #1b2231;
  color:#5d6780;font-size:12px;line-height:1.6;}
#k-pick .k-close{margin-top:14px;width:100%;background:none;border:0;color:#5d6780;
  font-size:13px;cursor:pointer;padding:6px;}
#k-pick .k-close:hover{color:#8a93a8;}
`;

/** The buttons themselves, for `#k-head`. Each appears only if it can work. */
function chromeButtons(opts: { hubUrl?: string; picker?: KioskPicker }, lang: 'zh' | 'en'): string {
  const back = opts.hubUrl
    ? `<a class="k-chrome" href="${esc(opts.hubUrl)}" title="${esc(UI[lang].back)}">← ASTELLUM</a>`
    : '';
  const pick = opts.picker
    ? `<button class="k-chrome" id="k-pick-btn" data-zh="${esc(UI.zh.pick)}" data-en="${esc(UI.en.pick)}">${esc(UI[lang].pick)}</button>`
    : '';
  return back + pick;
}

/** The overlay form. Lifted from the kiosk's old front door, which this replaces. */
function pickerOverlay(picker: KioskPicker | undefined, lang: 'zh' | 'en'): string {
  if (!picker) return '';
  const styles =
    picker.styles && picker.styles.length > 1
      ? `<label><span data-zh="${esc(UI.zh.styleLabel)}" data-en="${esc(UI.en.styleLabel)}">${esc(UI[lang].styleLabel)}</span>
      <select id="k-pick-style">${picker.styles
        .map((s) => `<option>${esc(s)}</option>`)
        .join('')}</select></label>`
      : '';
  const foot = picker.offlineNote
    ? `<p class="k-foot" data-zh="${esc(picker.offlineNote.zh)}" data-en="${esc(picker.offlineNote.en)}">${esc(picker.offlineNote[lang])}</p>`
    : '';
  return `
<div id="k-pick-wrap">
  <form id="k-pick">
    <h2 data-zh="${esc(UI.zh.pickTitle)}" data-en="${esc(UI.en.pickTitle)}">${esc(UI[lang].pickTitle)}</h2>
    <p class="k-sub" data-zh="${esc(UI.zh.pickSub)}" data-en="${esc(UI.en.pickSub)}">${esc(UI[lang].pickSub)}</p>

    <label class="k-file">
      <input type="file" id="k-pick-file" accept="${PICK_ACCEPT}">
      <span id="k-pick-name" data-zh="${esc(UI.zh.fileHint)}" data-en="${esc(UI.en.fileHint)}">${esc(UI[lang].fileHint)}</span>
    </label>

    <label><span data-zh="${esc(UI.zh.targetLabel)}" data-en="${esc(UI.en.targetLabel)}">${esc(UI[lang].targetLabel)}</span>
      <input type="text" id="k-pick-target" placeholder="M42 / NGC 3372 / Sh2-308">
    </label>

    <div class="k-row">
      <label><span data-zh="${esc(UI.zh.langLabel)}" data-en="${esc(UI.en.langLabel)}">${esc(UI[lang].langLabel)}</span>
        <select id="k-pick-lang">
          <option value="zh"${lang === 'zh' ? ' selected' : ''}>中文</option>
          <option value="en"${lang === 'en' ? ' selected' : ''}>English</option>
        </select>
      </label>
      ${styles}
    </div>

    <button class="k-go" id="k-pick-go" type="submit" disabled
      data-zh="${esc(UI.zh.start)}" data-en="${esc(UI.en.start)}">${esc(UI[lang].start)}</button>
    <p class="k-status" id="k-pick-status"></p>
    ${foot}
    <button class="k-close" id="k-pick-close" type="button"
      data-zh="${esc(UI.zh.close)}" data-en="${esc(UI.en.close)}">${esc(UI[lang].close)}</button>
  </form>
</div>`;
}

/**
 * Behaviour for both of the above. Self-contained on purpose: it does not call
 * the reading page's idleReset, because the global pointerdown listener there
 * already rearms the timer for anything the page does.
 */
function chromeScript(picker?: KioskPicker): string {
  return `
(function(){
  // Remember the language the way the hub does — same cookie, same path, and
  // cookies ignore the port, so the dashboard and the kiosk stay in step in
  // both directions. Each page flips its own labels; this only records it.
  // (A file:// page has no cookie jar, hence the try.)
  var langBtn=document.getElementById('k-lang');
  if(langBtn) langBtn.addEventListener('click', function(){
    var next=document.documentElement.lang==='zh'?'en':'zh';
    try{ document.cookie='astellum_lang='+next+';path=/;max-age=31536000'; }catch(e){}
  });

  var head=document.getElementById('k-head');
  // No hover on a touchscreen, so a touch in the head stands in for one.
  if(head) head.addEventListener('pointerdown', function(){
    head.classList.add('lit');
    clearTimeout(head._dim);
    head._dim=setTimeout(function(){ head.classList.remove('lit'); }, 4000);
  }, {passive:true});
${
  picker
    ? `
  var wrap=document.getElementById('k-pick-wrap'),
      form=document.getElementById('k-pick'),
      file=document.getElementById('k-pick-file'),
      fname=document.getElementById('k-pick-name'),
      go=document.getElementById('k-pick-go'),
      st=document.getElementById('k-pick-status');
  function openPick(e){ if(e) e.stopPropagation(); wrap.classList.add('show'); }
  function closePick(){ wrap.classList.remove('show'); }
  document.getElementById('k-pick-btn').addEventListener('click', openPick);
  document.getElementById('k-pick-close').addEventListener('click', closePick);
  // The backdrop closes; the card itself must not.
  wrap.addEventListener('click', function(e){ if(e.target===wrap) closePick(); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closePick(); });

  file.addEventListener('change', function(){
    var f=file.files[0];
    if(f){ fname.textContent=f.name; fname.removeAttribute('data-zh'); fname.removeAttribute('data-en'); }
    go.disabled=!f;
  });
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var f=file.files[0]; if(!f) return;
    go.disabled=true;
    st.className='k-status';
    st.textContent=T('reading');
    var b64=await new Promise(function(res,rej){
      var r=new FileReader(); r.onload=function(){res(r.result);}; r.onerror=rej; r.readAsDataURL(f);
    });
    st.textContent=T('solving');
    try{
      var styleSel=document.getElementById('k-pick-style');
      var r=await fetch(${JSON.stringify(picker.endpoint)},{method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({filename:f.name, dataUrl:b64,
          target:document.getElementById('k-pick-target').value.trim()||undefined,
          lang:document.getElementById('k-pick-lang').value,
          style:styleSel?styleSel.value:undefined})});
      var j=await r.json();
      if(!j.ok) throw new Error(j.error||T('failed'));
      st.textContent=T('opening');
      location.href=j.url;
    }catch(err){
      st.className='k-status err';
      st.textContent=String(err.message||err);
      go.disabled=false;
    }
  });`
    : ''
}
})();`;
}

/** The handful of strings the picker's script needs at runtime, in both languages. */
function chromeStrings(): string {
  const keys = ['reading', 'solving', 'opening', 'failed'] as const;
  const table = Object.fromEntries(keys.map((k) => [k, { zh: UI.zh[k], en: UI.en[k] }]));
  return `var CHROME_T=${JSON.stringify(table)};
function T(k){ return CHROME_T[k][document.documentElement.lang==='en'?'en':'zh']; }`;
}

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
      // The authored radius stays the layout number: spreadBadges() solved the
      // overlaps for exactly this size, and inflating it here silently undoes
      // that work. Reach is added below with an invisible hit circle instead,
      // which costs the layout nothing.
      const bR = f.badge.bubble_r;
      // Only the paint shrinks. The number's job is to say "something is here,
      // and it is the fourth one" — at full size it was louder than the
      // structure it points at, and with the name beside it the pair would be
      // louder still. The anchor still uses the authored radius, so the
      // standoff opens up a little, which is where the name goes.
      const drawnR = bR * BADGE_SCALE;
      const [ax, ay] = badgeAnchor(f, bR);
      const bx = ax + f.badge.offset_x;
      const by = ay + f.badge.offset_y;
      const shape =
        f.shape === 'polygon' && f.polygon?.length
          ? `<polygon class="k-mark" points="${f.polygon.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c.stroke}" stroke-width="${strokeW}"/>`
          : f.shape === 'polyline' && f.polygon?.length
            ? `<polyline class="k-mark" points="${f.polygon.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c.stroke}" stroke-width="${strokeW}"/>`
            : `<circle class="k-mark" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.stroke}" stroke-width="${strokeW}"/>`;
      const name = overlayLabel({
        text: f.label[lang],
        bilingual: { zh: f.label.zh, en: f.label.en },
        x: bx,
        y: by,
        bubbleR: bR,
        drawnR,
        color: c.stroke,
        frameWidth: width,
        className: 'k-label',
      });
      return `<g class="k-feat" data-f="${esc(f.id)}" tabindex="0" role="button">
  ${shape}
  <circle class="k-badge" cx="${bx}" cy="${by}" r="${drawnR}" fill="${c.badge}" stroke="#0b0e14" stroke-width="${Math.max(1, strokeW / 2)}"/>
  <text class="k-num" x="${bx}" y="${by}" font-size="${drawnR * 1.15}" font-weight="700" fill="#0b0e14" text-anchor="middle" dominant-baseline="central">${esc(f.badge.num)}</text>
  ${name}
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
<title>${esc(report.object.name[lang])} — ASTELLUM</title>
<link rel="icon" type="image/svg+xml" href="${KIOSK_FAVICON_DATA_URI}">
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
/* Three levels, because eight marks at one strength is eight things shouting.
   Idle the outlines sit back and the numbers carry the invitation to touch;
   once something is chosen everything else gets out of its way — but not so
   far that the audience loses track of what else is on offer. */
.k-feat .k-mark,.k-feat .k-label{opacity:.5;transition:opacity .2s;}
.k-feat .k-badge,.k-feat .k-num{opacity:.72;transition:opacity .2s,transform .2s;}
.k-feat .k-badge{transform-origin:center;transform-box:fill-box;}
.k-feat.active .k-mark,.k-feat:focus .k-mark,
.k-feat.active .k-label,.k-feat:focus .k-label,
.k-feat.active .k-badge,.k-feat.active .k-num{opacity:1;}
.k-feat.active .k-badge{transform:scale(1.18);}
#k-svg.has-active .k-feat:not(.active) .k-mark{opacity:.14;}
#k-svg.has-active .k-feat:not(.active) .k-label{opacity:.12;}
#k-svg.has-active .k-feat:not(.active) .k-badge,
#k-svg.has-active .k-feat:not(.active) .k-num{opacity:.4;}
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
${CHROME_CSS}
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
      ${chromeButtons(opts, lang)}
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
${pickerOverlay(opts.picker, lang)}
<script>
${chromeStrings()}
${chromeScript(opts.picker)}
</script>
<script>
(function(){
  var LANG=${JSON.stringify(lang)};
  var TEXT=${JSON.stringify(i18nData)};
  var NAME=${JSON.stringify({ zh: report.object.name.zh, en: report.object.name.en })};
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
    document.getElementById('k-svg').classList.toggle('has-active', !!id);
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
  function applyLang(next){
    LANG = next;
    document.documentElement.lang=LANG;
    // The tab is part of the page. Leaving it in the language the file was
    // built in makes the browser contradict what is on screen.
    document.title = NAME[LANG] + ' \u2014 ASTELLUM';
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
  }

  document.getElementById('k-lang').addEventListener('click', function(){
    applyLang(LANG==='zh' ? 'en' : 'zh');
    idleReset();
  });

  // This page is a file: the language it was built in is frozen into it, while
  // the operator may have changed theirs on another surface since. Both
  // languages ship here, so honour the newer statement — their current choice —
  // and start in it. A file:// page has no cookie jar; it keeps what it was
  // built with, which is the only thing it can know.
  try {
    var want=(document.cookie.match(/astellum_lang=(zh|en)/)||[])[1];
    if(want && want!==LANG) applyLang(want);
  } catch(e){}

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

export interface KioskShellOptions {
  /** Where "← ASTELLUM" goes; omitted when nothing launched this. */
  hubUrl?: string;
  /** The picker. Without it this page can only sit there, so pass one. */
  picker?: KioskPicker;
  /** Which language to open in. Default 'zh'. */
  lang?: 'zh' | 'en';
}

/**
 * The kiosk with nothing on it yet.
 *
 * The front door used to be a screen of its own between the hub and the frame,
 * which meant the kiosk's address showed you a form rather than the kiosk. This
 * is what that address answers with now: the same dark fullscreen surface, the
 * same chrome in the same corner, and one line telling you where to start. Pick
 * an image and the frame replaces it.
 */
export function generateKioskShellHtml(opts: KioskShellOptions = {}): string {
  const lang = opts.lang ?? 'zh';
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>ASTELLUM</title>
<link rel="icon" type="image/svg+xml" href="${KIOSK_FAVICON_DATA_URI}">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;background:#05070c;color:#e6e9f0;
  font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-tap-highlight-color:transparent;user-select:none;}
${CHROME_CSS}
/* No panel to sit on, so the head becomes a bar in the same corner it occupies
   on a frame — muscle memory carries over from one to the other. */
#k-bar{position:fixed;top:0;right:0;z-index:10;display:flex;justify-content:flex-end;}
#k-bar #k-head{border-bottom:0;}
/* Covers the whole screen to centre one line, so it has to let clicks through —
   otherwise it sits on top of the bar and swallows every press on it. */
#k-empty{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  padding:24px;text-align:center;color:#5d6780;font-size:clamp(15px,1.8vw,19px);
  pointer-events:none;}
</style>
</head>
<body>
<div id="k-bar">
  <div id="k-head">
    ${chromeButtons(opts, lang)}
    <button id="k-lang" data-zh="${esc(UI.zh.langBtn)}" data-en="${esc(UI.en.langBtn)}">${esc(UI[lang].langBtn)}</button>
  </div>
</div>
<p id="k-empty" data-zh="${esc(UI.zh.emptyHint)}" data-en="${esc(UI.en.emptyHint)}">${esc(UI[lang].emptyHint)}</p>
${pickerOverlay(opts.picker, lang)}
<script>
${chromeStrings()}
${chromeScript(opts.picker)}
// This page carries no reading, so the language switch is just the generic
// textContent swap the rest of the page already relies on.
(function(){
  var LANG=${JSON.stringify(lang)};
  document.getElementById('k-lang').addEventListener('click', function(){
    LANG = LANG==='zh' ? 'en' : 'zh';
    document.documentElement.lang=LANG;
    document.querySelectorAll('[data-zh]').forEach(function(el){
      el.textContent = el.getAttribute('data-'+LANG) || el.textContent;
    });
  });
})();
</script>
</body>
</html>`;
}
