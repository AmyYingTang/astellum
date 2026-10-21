import {
  COLOR_PALETTE,
  badgeAnchor,
  type Feature,
  type Reading,
  type StylePreset,
} from '@astellum/schema';
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
  /** Endpoint that takes {filename, dataUrl, target, lang, style, tone} and
   *  answers {ok, url} — the kiosk server's /api/run. */
  endpoint: string;
  /** Offered in the form when the library has more than one. */
  styles?: string[];
  /**
   * Audience buttons, when this deployment writes its words on the night
   * (`kiosk.readingSource: 'ai'`) rather than reading what a curator wrote.
   * Supplied instead of `styles`: picking from a library and describing an
   * audience are the same question asked of two different machines.
   */
  presets?: StylePreset[];
  /** Offline-catalogue state, already phrased; shown under the form. */
  offlineNote?: { zh: string; en: string };
}

const UI = {
  zh: {
    nearHint: '把手指或鼠标靠近任何一个标注，看看那是什么',
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
    zoomIn: '放大',
    zoomOut: '缩小',
    zoomReset: '复位',
    allItems: '全部',
    audienceLabel: '讲给谁听',
    focusLabel: '侧重',
    customLabel: '还想补充什么(可选)',
    aiNote: '现场为这批观众写文字:需要网络,要等模型几十秒。身份、位置和颜色仍然来自识别,模型只改措辞。',
    poster: '海报',
    posterPortrait: '竖版',
    posterLandscape: '横版',
    posterWait: '生成中…',
    no_annotations: '这张图已经认出目标，但标注库里还没有它的标注。',
    generic_only: '下面是这类结构的通用说明，还没有针对这个目标写的解读。',
    unsolved: '这张图没能解析出天区，所以下面不做任何身份判断。',
  },
  en: {
    nearHint: 'Come near any mark to find out what it is',
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
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomReset: 'Fit',
    allItems: 'All',
    audienceLabel: 'Who is this for',
    focusLabel: 'Lean towards',
    customLabel: 'Anything to add (optional)',
    aiNote: 'Written on the night for the people in front of you: needs a network, and the model takes tens of seconds. Identity, position and colour still come from the identification — the model only changes the wording.',
    poster: 'Poster',
    posterPortrait: 'Portrait',
    posterLandscape: 'Landscape',
    posterWait: 'Rendering…',
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
 * It used to sit at a third opacity so a visitor would not wander into
 * "← ASTELLUM" — but on a black screen that is not discretion, it is a row of
 * controls the operator cannot find either. They are lit like everything else
 * now; keeping the audience out of them is the operator's job, not the
 * stylesheet's.
 */
const CHROME_CSS = `
#k-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:14px 22px;border-bottom:1px solid #1b2231;}
#k-head button,.k-style{background:#141925;border:1px solid #2a3346;color:#cfd6e4;
  border-radius:9px;padding:8px 14px;font-size:14px;cursor:pointer;white-space:nowrap;}
#k-head button:hover{background:#1c2333;}
.k-style{display:flex;gap:8px;align-items:center;font-size:13px;color:#8a93a8;padding:6px 10px;}
.k-style select{background:transparent;border:0;color:#cfd6e4;font-size:14px;}
a.k-chrome{display:inline-block;color:#cfd6e4;text-decoration:none;font-size:13px;
  white-space:nowrap;padding:8px 12px;border:1px solid #2a3346;border-radius:9px;}
a.k-chrome:hover{background:#1c2333;border-color:#3a4a6b;}

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
/* Two layouts, one click away. The menu is a sibling so it can sit under the
   button without the head growing a row. */
#k-poster-wrap{position:relative;display:inline-block;}
#k-poster-menu{display:none;position:absolute;top:calc(100% + 6px);right:0;z-index:5;
  background:#0b0f18;border:1px solid #2a3346;border-radius:10px;padding:6px;
  flex-direction:column;gap:4px;min-width:110px;}
#k-poster-wrap.open #k-poster-menu{display:flex;}
#k-poster-menu button{background:none;border:0;color:#cfd6e4;font:inherit;font-size:13px;
  text-align:left;padding:7px 10px;border-radius:7px;cursor:pointer;width:100%;}
#k-poster-menu button:hover{background:#1c2333;}
#k-poster[disabled]{opacity:1;cursor:progress;}
#k-pick .k-chips{margin-top:20px;font-size:13px;color:#8a93a8;}
#k-pick .k-chips>div{margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;}
#k-pick .k-chip{background:#141925;border:1px solid #2a3344;color:#cfd6e4;
  border-radius:999px;padding:7px 14px;font-size:13px;cursor:pointer;}
#k-pick .k-chip:hover{border-color:#3f4d6b;}
#k-pick .k-chip.on{background:#2b6cb0;border-color:#2b6cb0;color:#fff;}
#k-pick .k-note{margin-top:16px;color:#6b768f;font-size:12px;line-height:1.6;}
#k-pick .k-foot{margin-top:22px;padding-top:16px;border-top:1px solid #1b2231;
  color:#5d6780;font-size:12px;line-height:1.6;}
#k-pick .k-close{margin-top:14px;width:100%;background:none;border:0;color:#5d6780;
  font-size:13px;cursor:pointer;padding:6px;}
#k-pick .k-close:hover{color:#8a93a8;}
`;

/** The buttons themselves, for `#k-head`. Each appears only if it can work. */
function chromeButtons(
  opts: { hubUrl?: string; picker?: KioskPicker; poster?: boolean },
  lang: 'zh' | 'en',
): string {
  const back = opts.hubUrl
    ? `<a class="k-chrome" href="${esc(opts.hubUrl)}" title="${esc(UI[lang].back)}">← ASTELLUM</a>`
    : '';
  const pick = opts.picker
    ? `<button class="k-chrome" id="k-pick-btn" data-zh="${esc(UI.zh.pick)}" data-en="${esc(UI.en.pick)}">${esc(UI[lang].pick)}</button>`
    : '';
  // Printing needs both a frame to print and the server that rendered it, so
  // neither the portable file:// page nor the empty shell offers it.
  const poster = opts.poster && opts.picker
    ? `<span id="k-poster-wrap"><button class="k-chrome" id="k-poster" data-zh="${esc(UI.zh.poster)}" data-en="${esc(UI.en.poster)}">${esc(UI[lang].poster)}</button>` +
      `<span id="k-poster-menu">` +
      `<button data-layout="portrait" data-zh="${esc(UI.zh.posterPortrait)}" data-en="${esc(UI.en.posterPortrait)}">${esc(UI[lang].posterPortrait)}</button>` +
      `<button data-layout="landscape" data-zh="${esc(UI.zh.posterLandscape)}" data-en="${esc(UI.en.posterLandscape)}">${esc(UI[lang].posterLandscape)}</button>` +
      `</span></span>`
    : '';
  return back + pick + poster;
}

/** The overlay form. Lifted from the kiosk's old front door, which this replaces. */
function pickerOverlay(picker: KioskPicker | undefined, lang: 'zh' | 'en'): string {
  if (!picker) return '';
  const group = (g: 'audience' | 'focus', label: 'audienceLabel' | 'focusLabel'): string => {
    const chips = (picker.presets ?? []).filter((x) => x.group === g);
    if (!chips.length) return '';
    return `<div class="k-chips"><span data-zh="${esc(UI.zh[label])}" data-en="${esc(UI.en[label])}">${esc(UI[lang][label])}</span>
      <div>${chips
        .map(
          (c) =>
            `<button type="button" class="k-chip" data-zh="${esc(c.labelZh)}" data-en="${esc(c.labelEn)}" ` +
            `data-text-zh="${esc(c.textZh)}" data-text-en="${esc(c.textEn)}">${esc(lang === 'zh' ? c.labelZh : c.labelEn)}</button>`,
        )
        .join('')}</div></div>`;
  };
  // Either the library's styles or an audience to write for — never both; which
  // one the server offers is what `kiosk.readingSource` decides.
  const presets = picker.presets?.length
    ? `${group('audience', 'audienceLabel')}${group('focus', 'focusLabel')}
    <label><span data-zh="${esc(UI.zh.customLabel)}" data-en="${esc(UI.en.customLabel)}">${esc(UI[lang].customLabel)}</span>
      <input type="text" id="k-pick-tone" placeholder="${esc(lang === 'zh' ? '例如:观众里有小朋友' : 'e.g. there are children in the room')}">
    </label>
    <p class="k-note" data-zh="${esc(UI.zh.aiNote)}" data-en="${esc(UI.en.aiNote)}">${esc(UI[lang].aiNote)}</p>`
    : '';
  const styles =
    !picker.presets?.length && picker.styles && picker.styles.length > 1
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
    ${presets}

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

  /*
   * The poster. The frame knows its own id from the address it was served
   * from, and the server re-renders from the files it wrote — so this is a
   * link, not an upload. It takes seconds (a headless browser starts), hence
   * the waiting state: without it the operator clicks again and gets two.
   */
  var posterBtn=document.getElementById('k-poster');
  if(posterBtn){
    var posterWrap=document.getElementById('k-poster-wrap');
    posterBtn.addEventListener('click', function(e){
      e.stopPropagation();
      posterWrap.classList.toggle('open');
    });
    document.addEventListener('click', function(){ posterWrap.classList.remove('open'); });
    document.querySelectorAll('#k-poster-menu button').forEach(function(b){
      b.addEventListener('click', async function(e){
        e.stopPropagation();
        posterWrap.classList.remove('open');
        var was=posterBtn.textContent;
        posterBtn.disabled=true;
        posterBtn.textContent=T('posterWait');
        try{
          var url=location.pathname.replace(/\\/$/,'')+'/poster?layout='+b.getAttribute('data-layout')+
                  '&lang='+(document.documentElement.lang==='en'?'en':'zh');
          var r=await fetch(url);
          if(!r.ok) throw new Error(await r.text());
          var blob=await r.blob();
          var name=(r.headers.get('content-disposition')||'').match(/filename="([^"]+)"/);
          var a=document.createElement('a');
          a.href=URL.createObjectURL(blob);
          a.download=name?name[1]:'poster.png';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function(){ URL.revokeObjectURL(a.href); }, 10000);
        }catch(err){
          posterBtn.title=String(err.message||err);
        }finally{
          posterBtn.disabled=false;
          posterBtn.textContent=was;
        }
      });
    });
  }

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

  // A chip is a sentence the model will be given, not a filter — so they add
  // up, and nothing is selected by default: the operator says what is true of
  // the room, or says nothing.
  document.querySelectorAll('#k-pick .k-chip').forEach(function(c){
    c.addEventListener('click', function(){ c.classList.toggle('on'); });
  });
  function tone(){
    var l=document.getElementById('k-pick-lang').value==='en'?'en':'zh';
    var parts=[];
    document.querySelectorAll('#k-pick .k-chip.on').forEach(function(c){
      parts.push(c.getAttribute('data-text-'+l));
    });
    var free=document.getElementById('k-pick-tone');
    if(free && free.value.trim()) parts.push(free.value.trim());
    return parts.length?parts.join(' '):undefined;
  }

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
          style:styleSel?styleSel.value:undefined,
          tone:tone()})});
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
  const keys = ['reading', 'solving', 'opening', 'failed', 'posterWait'] as const;
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

  /**
   * The feature's extent in image pixels. Only a polygon or a polyline carries
   * its real one; for every other shape `circle` is a fixed-size marker, so
   * this is a floor as much as a measurement.
   */
  const bboxOf = (f: Feature): { cx: number; cy: number; half: number } => {
    let x0: number;
    let y0: number;
    let x1: number;
    let y1: number;
    if (f.polygon?.length && (f.shape === 'polygon' || f.shape === 'polyline')) {
      const xs = f.polygon.map((q) => q[0]);
      const ys = f.polygon.map((q) => q[1]);
      x0 = Math.min(...xs);
      x1 = Math.max(...xs);
      y0 = Math.min(...ys);
      y1 = Math.max(...ys);
    } else {
      x0 = f.circle.cx - f.circle.r;
      x1 = f.circle.cx + f.circle.r;
      y0 = f.circle.cy - f.circle.r;
      y1 = f.circle.cy + f.circle.r;
    }
    return {
      cx: Math.round((x0 + x1) / 2),
      cy: Math.round((y0 + y1) / 2),
      half: Math.round(Math.max((x1 - x0) / 2, (y1 - y0) / 2, Math.min(width, height) / 50)),
    };
  };

  // Biggest first, so the smallest marks end up on top. Whatever is topmost
  // wins the pointer, and a pillar a few dozen pixels across is the one that
  // needs the help — a ring around the whole nebula can be met almost anywhere
  // along its rim. This is paint order only; the numbers were assigned long ago.
  const drawn = report.features
    .filter((f) => f.draw !== false)
    .map((f, i) => ({ f, i, size: bboxOf(f).half }))
    .sort((a, b) => b.size - a.size || a.i - b.i)
    .map((e) => e.f);

  const overlay = drawn
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
        f.shape === 'field'
          ? '' // the frame is a crop of it; no ring here could enclose it
          : f.shape === 'polygon' && f.polygon?.length
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
        plate: true,
      });
      // The shape is kept for its geometry — the crop masks with it — but it is
      // not a target. Making the structures sensitive sounded right and was
      // not: the ring around the whole nebula runs past half the other marks,
      // and standing anywhere near its rim beat them all. What the viewer aims
      // at is the number and the name, so those are what answer.
      const pts = f.polygon?.length ? f.polygon.map((q) => q.join(',')).join(' ') : '';
      const reach = `stroke="transparent" stroke-width="${hitR}" stroke-linejoin="round"`;
      const hit =
        f.shape === 'field'
          ? '' // nothing to come near: it is the whole picture
          : f.shape === 'polygon' && pts
          ? `<polygon class="k-geo" points="${pts}" fill="transparent" ${reach}/>`
          : f.shape === 'polyline' && pts
            ? `<polyline class="k-geo" points="${pts}" fill="none" ${reach}/>`
            : `<circle class="k-geo" cx="${cx}" cy="${cy}" r="${r}" ${reach} fill="${
                r <= Math.min(width, height) * 0.12 ? 'transparent' : 'none'
              }"/>`;
      return `<g class="k-feat" data-f="${esc(f.id)}" tabindex="0" role="button">
  ${shape}
  <circle class="k-badge" cx="${bx}" cy="${by}" r="${drawnR}" fill="${c.badge}" stroke="#0b0e14" stroke-width="${Math.max(1, strokeW / 2)}"/>
  <text class="k-num" x="${bx}" y="${by}" font-size="${drawnR * 1.15}" font-weight="700" fill="#0b0e14" text-anchor="middle" dominant-baseline="central">${esc(f.badge.num)}</text>
  ${name}
  ${hit}
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

  /** Where the magnified view crops, per feature, in image pixels. */
  const crops = drawn.map((f) => ({ id: f.id, ...bboxOf(f) }));

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
/* One row of controls across the top, then picture and words beneath it. The
   head used to live inside the panel, where it had a third of the width to fit
   in and wrapped into two cramped rows. */
#k{position:fixed;inset:0;display:flex;flex-direction:column;}
#k-main{flex:1 1 auto;min-height:0;display:flex;align-items:stretch;}
#k-view{flex:1 1 auto;min-width:0;position:relative;display:flex;
  align-items:center;justify-content:center;padding:12px;}
/* The overlay is a 100%×100% SVG over the stage, so the stage box must have the
   image's exact proportions — otherwise every circle renders as an ellipse.
   Width + aspect-ratio only: an explicit height as well would override the
   ratio, letterboxing the photo inside a taller box and leaving the overlay
   floating off the picture. */
#k-stage{position:relative;aspect-ratio:${width}/${height};width:100%;
  max-width:calc((100vh - var(--k-head,64px) - 24px) * ${width} / ${height});
  max-height:100%;line-height:0;
  overflow:hidden;touch-action:none;}
#k-zoomwrap{position:absolute;inset:0;transform-origin:0 0;
  transition:transform .12s ease-out;will-change:transform;}
#k-zoomwrap.k-drag{transition:none;}
#k-stage img{width:100%;height:100%;display:block;object-fit:contain;}
#k-svg{position:absolute;inset:0;width:100%;height:100%;}
.k-feat{cursor:pointer;}
/* At rest the picture is a picture: numbers and names, and nothing drawn over
   the nebula itself. The outline belongs to whichever one is being read — it
   is the only thing that says which part of the frame the name is about, since
   the magnified view beside it is a plain crop. */
.k-feat .k-mark{opacity:0;transition:opacity .2s;}
.k-feat .k-label{opacity:.82;transition:opacity .2s;}
.k-feat .k-badge,.k-feat .k-num{opacity:.72;transition:opacity .2s,transform .2s;}
.k-feat .k-badge{transform-origin:center;transform-box:fill-box;}
.k-feat.active .k-mark,.k-feat:focus .k-mark,
.k-feat.active .k-label,.k-feat:focus .k-label,
.k-feat.active .k-badge,.k-feat.active .k-num{opacity:1;}
.k-feat.active .k-badge{transform:scale(1.18);}
#k-svg.has-active .k-feat:not(.active) .k-label{opacity:.3;}
/* The slab has to fade harder than the word on it. Opacity multiplies down the
   tree, so a plate dimmed on its own account all but disappears while its text
   merely recedes — otherwise a faded label reads as a grey smear laid over the
   photograph, which is what a reader noticed on the dust lane. */
#k-svg.has-active .k-feat:not(.active) .k-plate{opacity:.18;}
/* Dropped because its plate had nowhere to go. Coming near brings it back —
   the rule below outranks this one, which is the whole reason it may go. */
.k-label.crowded{opacity:0;}
.k-feat.active .k-label.crowded{opacity:1;}
#k-svg.has-active .k-feat:not(.active) .k-badge,
#k-svg.has-active .k-feat:not(.active) .k-num{opacity:.4;}
.k-feat:focus{outline:none;}
/* One dark slab under every name. The halo it replaces kept the feature's own
   colour, which disappears when that colour is grey and the background is a
   white core — which is what a reader ran into. Nothing here depends on what
   is behind it. */
.k-plate{fill:rgba(8,11,18,.9);}
/* The zoom controls sit with the rest of the chrome and fade like it: a
   touchscreen cannot be relied on for pinch, so these are the floor. */
#k-zoomers{display:flex;gap:4px;}
#k-zoomers button{min-width:34px;font-size:16px;line-height:1;}
/* Geometry for the crop's mask, nothing more — it must not answer the pointer,
   or clicking a structure would do what coming near it no longer does. */
.k-geo{pointer-events:none;}
/* What is being read: the piece of sky, then the words about it. Both appear
   together and both go when the pointer moves on. */
#k-read{display:none;}
#k-read.show{display:block;}
/* Two fifths of the screen's height, square, and never wider than the panel
   it sits in: big enough to be looked at, small enough that the words beside
   it are still the point. Sized from the height because that is what runs out
   first — the panel's width is a user's drag away from anything. */
#k-crop{width:min(100%,40vh);aspect-ratio:1/1;border-radius:12px;overflow:hidden;
  border:1px solid #243049;background:#05070c;}
#k-crop svg{display:block;width:100%;height:100%;}
#k-read-title{margin-top:16px;font-size:clamp(18px,2.1vw,26px);font-weight:700;line-height:1.3;}
#k-read-body p{margin-top:10px;font-size:clamp(14px,1.5vw,18px);line-height:1.8;color:#ccd4e3;}
/* The whole list, one row away. It is how a visitor sees what else is here
   without hunting the picture, but it is not what they came to read first. */
#k-all{display:none;margin-top:26px;border-top:1px solid #1b2231;}
#k-all.show{display:block;}
#k-all-head{width:100%;text-align:left;padding:14px 2px;background:none;border:0;
  color:#8a93a8;font:inherit;font-size:14px;cursor:pointer;}
#k-all-head:hover{color:#cfd6e4;}
#k-all-body{display:none;}
#k-all.open #k-all-body{display:block;}
/* The invitation has to stay. A visitor arrives mid-session, after someone
   else has already touched something — if the line had gone for good they
   would face a picture with no way in. It stops pulsing once the screen has
   been used, since by then it is a reminder rather than a summons. */
#k-hint{position:absolute;left:50%;bottom:3%;transform:translateX(-50%);
  padding:12px 24px;border-radius:999px;background:rgba(10,14,22,.82);
  border:1px solid #2a3346;color:#e6e9f0;font-size:clamp(14px,1.8vw,20px);
  line-height:1;white-space:nowrap;animation:k-pulse 2.6s ease-in-out infinite;}
@keyframes k-pulse{0%,100%{opacity:.55;}50%{opacity:1;}}
#k-hint.quiet{animation:none;opacity:.5;}

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
#k>#k-head{flex:0 0 auto;height:var(--k-head,64px);box-sizing:border-box;
  padding:0 22px;flex-wrap:nowrap;overflow-x:auto;background:#070a10;}
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
  #k-main{flex-direction:column;}
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
  <div id="k-head">
    <span id="k-zoomers">
      <button id="k-zi" class="k-chrome" title="${esc(UI[lang].zoomIn)}" aria-label="${esc(UI[lang].zoomIn)}">+</button>
      <button id="k-zo" class="k-chrome" title="${esc(UI[lang].zoomOut)}" aria-label="${esc(UI[lang].zoomOut)}">−</button>
      <button id="k-zr" class="k-chrome" title="${esc(UI[lang].zoomReset)}" aria-label="${esc(UI[lang].zoomReset)}">⟲</button>
    </span>
    ${chromeButtons({ ...opts, poster: true }, lang)}
    <button id="k-lang" data-zh="${esc(UI.zh.langBtn)}" data-en="${esc(UI.en.langBtn)}">${esc(UI[lang].langBtn)}</button>
    ${styleSwitch}
  </div>
  <div id="k-main">
  <div id="k-view">
    <div id="k-stage">
      <!-- Picture and marks ride one transform: zoom either on its own and the
           labels would drift off the sky they name. The hint and the crop stay
           outside it — they belong to the screen, not to the photograph. -->
      <div id="k-zoomwrap">
        <img src="${opts.imageDataUri}" alt="${esc(report.object.name[lang])}">
        <svg id="k-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
${overlay}
        </svg>
      </div>
      <div id="k-hint" data-zh="${esc(UI.zh.nearHint)}" data-en="${esc(UI.en.nearHint)}">${esc(UI[lang].nearHint)}</div>
    </div>
    ${info}
  </div>
  <div id="k-split" role="separator" aria-orientation="vertical"></div>
  <aside id="k-panel">
    <!-- At rest this holds the subject of the picture — the first mark, which
         is what the frame is of. Anything else read replaces it, and the idle
         timer brings it back: a kiosk nobody is touching should still say what
         is on the screen. -->
    <div id="k-body">
      <div id="k-read">
        <div id="k-crop"></div>
        <h2 id="k-read-title"></h2>
        <div id="k-read-body"></div>
      </div>
      <div id="k-all">
        <button id="k-all-head" data-zh="${esc(UI.zh.allItems)} (${report.features.filter((f) => f.draw !== false).length})" data-en="${esc(UI.en.allItems)} (${report.features.filter((f) => f.draw !== false).length})">${esc(UI[lang].allItems)} (${report.features.filter((f) => f.draw !== false).length})</button>
        <div id="k-all-body">
          <div id="k-intro">
            <h1 id="k-title" data-zh="${esc(report.object.name.zh)}" data-en="${esc(report.object.name.en)}">${esc(report.object.name[lang])}</h1>
            <p id="k-narr" data-zh="${esc(report.narrative.zh)}" data-en="${esc(report.narrative.en)}">${esc(report.narrative[lang])}</p>
            ${extras}
          </div>
${cards}
        </div>
      </div>
    </div>
  </aside>
  </div>
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
  var CROPS=${JSON.stringify(crops)};
  var IMG_W=${width}, IMG_H=${height};
  var NAME=${JSON.stringify({ zh: report.object.name.zh, en: report.object.name.en })};
  var IDLE=${idle};
  // What the panel shows when nobody is pointing at anything: the first mark,
  // which the reader orders as the subject of the frame.
  var HOME=(TEXT[0]||{}).id||null;
  var hint=document.getElementById('k-hint');
  var panelEl=document.getElementById('k-panel');
  var body=document.getElementById('k-body');
  var stage=document.getElementById('k-stage');
  var photo=stage.querySelector('img');
  var timer=null, active=null;

  function idleReset(){
    if(!IDLE) return;
    clearTimeout(timer);
    // Back to the whole picture too: the next visitor should not arrive at
    // someone else's close-up of a corner.
    timer=setTimeout(function(){ show(null); resetZoom(); }, IDLE*1000);
  }

  function show(id){
    active=id;
    document.getElementById('k-svg').classList.toggle('has-active', !!id);
    document.querySelectorAll('.k-feat').forEach(function(g){
      var on = g.getAttribute('data-f')===id;
      g.classList.toggle('active', on);
      // SVG has no z-index: the only way to put the one being read above its
      // neighbours' plates is to make it the last thing drawn.
      if(on && g.parentNode && g.nextSibling) g.parentNode.appendChild(g);
    });
    document.querySelectorAll('.k-card').forEach(function(c){
      var on = c.getAttribute('data-f')===id;
      c.classList.toggle('open', on);
      // Bring the opened entry into view: on a long list the one you tapped on
      // the picture can easily be below the fold.
      if(on) c.scrollIntoView({block:'nearest',behavior:'smooth'});
    });
    if(id) hint.classList.add('quiet'); // used now — stop summoning
    showRead(id);
    idleReset();
  }

  /**
   * The magnified crop. Everything is measured from the photo's own box at the
   * moment it is shown, not from the aspect ratio the stage is supposed to
   * have — the ratio normally holds, but a dragged divider can clamp the box
   * and the two would quietly disagree.
   */
  /**
   * An outline drawn by hand rarely lands back on its first point, and the
   * atlas stores what was drawn. A line whose ends all but meet is an outline,
   * not a ridge: lighting only a band along it leaves a dark stripe down the
   * middle of the very thing being shown.
   */
  function nearlyClosed(pts){
    if(pts.length<4) return false;
    var a=pts[0], b=pts[pts.length-1];
    var xs=pts.map(function(q){return q[0];}), ys=pts.map(function(q){return q[1];});
    var span=Math.max(Math.max.apply(null,xs)-Math.min.apply(null,xs),
                      Math.max.apply(null,ys)-Math.min.apply(null,ys));
    return Math.sqrt((a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1])) <= span*0.08;
  }

  /**
   * Zoom and pan, on the layer that carries both the photograph and the marks.
   *
   * Scale about a point on screen so the thing under the finger stays under
   * it, then hold the picture against the stage: at rest it fills the frame,
   * and zoomed in it may be dragged but never pulled away from an edge, since
   * a kiosk has nobody to explain a blank corner to.
   */
  var readBox=document.getElementById('k-read');
  var cropBox=document.getElementById('k-crop');
  var readTitle=document.getElementById('k-read-title');
  var readBody=document.getElementById('k-read-body');
  var allBox=document.getElementById('k-all');
  document.getElementById('k-all-head').addEventListener('click', function(){
    allBox.classList.toggle('open');
    idleReset();
  });

  var zoomWrap=document.getElementById('k-zoomwrap');
  var zoom=1, panX=0, panY=0;
  var ZMIN=1, ZMAX=6;

  function applyZoom(){
    var r=stage.getBoundingClientRect();
    var maxX=r.width*(zoom-1), maxY=r.height*(zoom-1);
    panX=Math.min(0, Math.max(-maxX, panX));
    panY=Math.min(0, Math.max(-maxY, panY));
    zoomWrap.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')';
    document.getElementById('k-zr').disabled = zoom<=ZMIN+0.001;
  }

  /** Scale by a factor, keeping the given screen point fixed. */
  function zoomAt(factor, clientX, clientY){
    var r=stage.getBoundingClientRect();
    var px=(clientX===undefined? r.width/2 : clientX-r.left);
    var py=(clientY===undefined? r.height/2 : clientY-r.top);
    var next=Math.min(ZMAX, Math.max(ZMIN, zoom*factor));
    if(next===zoom) return;
    // The picture coordinate under the pointer must come out where it went in.
    panX = px - (px - panX) * (next/zoom);
    panY = py - (py - panY) * (next/zoom);
    zoom = next;
    applyZoom();
    idleReset();
  }

  function resetZoom(){ zoom=1; panX=0; panY=0; applyZoom(); }

  document.getElementById('k-zi').addEventListener('click', function(e){ e.stopPropagation(); zoomAt(1.4); });
  document.getElementById('k-zo').addEventListener('click', function(e){ e.stopPropagation(); zoomAt(1/1.4); });
  document.getElementById('k-zr').addEventListener('click', function(e){ e.stopPropagation(); resetZoom(); idleReset(); });

  stage.addEventListener('wheel', function(e){
    e.preventDefault();
    zoomAt(e.deltaY<0 ? 1.12 : 1/1.12, e.clientX, e.clientY);
  }, {passive:false});

  // Two fingers pinch; one finger pans, but only once there is somewhere to pan
  // to — otherwise a drag across the picture would fight the proximity reading.
  var touches={};
  var pinch=null;
  stage.addEventListener('pointerdown', function(e){
    touches[e.pointerId]={x:e.clientX, y:e.clientY};
    var ids=Object.keys(touches);
    if(ids.length===2){
      var a=touches[ids[0]], b=touches[ids[1]];
      pinch={ d:Math.hypot(a.x-b.x, a.y-b.y), cx:(a.x+b.x)/2, cy:(a.y+b.y)/2 };
      zoomWrap.classList.add('k-drag');
    }
  });
  stage.addEventListener('pointermove', function(e){
    if(!touches[e.pointerId]) return;
    var prev=touches[e.pointerId];
    touches[e.pointerId]={x:e.clientX, y:e.clientY};
    var ids=Object.keys(touches);
    if(ids.length>=2 && pinch){
      var a=touches[ids[0]], b=touches[ids[1]];
      var d=Math.hypot(a.x-b.x, a.y-b.y);
      if(pinch.d>0) zoomAt(d/pinch.d, pinch.cx, pinch.cy);
      pinch.d=d;
      return;
    }
    if(zoom>1 && e.pressure!==0){
      zoomWrap.classList.add('k-drag');
      panX+=e.clientX-prev.x; panY+=e.clientY-prev.y;
      applyZoom();
    }
  });
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){
    stage.addEventListener(ev, function(e){
      delete touches[e.pointerId];
      if(Object.keys(touches).length<2) pinch=null;
      zoomWrap.classList.remove('k-drag');
    });
  });

  applyZoom();

  /**
   * What is being read, in the panel: the piece of sky on top, the words under
   * it. The crop is drawn at a fixed square in the panel rather than floating
   * over the photograph — one place to look, and it never covers its own
   * subject.
   */
  function showRead(id){
    // Nothing being read is not nothing to say: fall back to the first mark,
    // which is the subject the picture is of.
    if(!id) id = HOME;
    if(!id){ readBox.classList.remove('show'); allBox.classList.remove('show','open'); return; }
    var geo=null, txt=null, i;
    for(i=0;i<GEO.length;i++){ if(GEO[i].id===id){ geo=GEO[i]; break; } }
    for(i=0;i<TEXT.length;i++){ if(TEXT[i].id===id){ txt=TEXT[i]; break; } }

    // The crop. A subject the frame is a crop of has no region of its own, so
    // it gets words only.
    var hasShape = geo && (geo.pts || geo.r!==undefined);
    if(hasShape){
      var bx0,by0,bx1,by1;
      if(geo.pts){
        var xs=geo.pts.map(function(q){return q[0];}), ys=geo.pts.map(function(q){return q[1];});
        bx0=Math.min.apply(null,xs); bx1=Math.max.apply(null,xs);
        by0=Math.min.apply(null,ys); by1=Math.max.apply(null,ys);
      } else {
        bx0=geo.cx-geo.r; bx1=geo.cx+geo.r; by0=geo.cy-geo.r; by1=geo.cy+geo.r;
      }
      var cx=Math.round((bx0+bx1)/2), cy=Math.round((by0+by1)/2);
      var half=Math.max((bx1-bx0)/2, (by1-by0)/2, Math.min(IMG_W,IMG_H)/50);
      var side=1000;                          // the crop's own units; CSS sizes it
      var k=side*0.78/(half*2);

      var band=Math.max(6, Math.round(Math.min(IMG_W, IMG_H)/100));
      var hole='';
      if(geo.pts){
        var pts=geo.pts.map(function(q){ return q[0]+','+q[1]; }).join(' ');
        // Black in a mask hides what it covers, so the region keeps the picture.
        hole = (geo.closed || nearlyClosed(geo.pts))
          ? '<polygon points="'+pts+'" fill="#000"/>'
          : '<polyline points="'+pts+'" fill="none" stroke="#000" stroke-width="'+(band*2)+
            '" stroke-linejoin="round" stroke-linecap="round"/>';
      } else {
        hole = geo.hollow
          ? '<circle cx="'+geo.cx+'" cy="'+geo.cy+'" r="'+geo.r+'" fill="none" stroke="#000" stroke-width="'+(band*2)+'"/>'
          : '<circle cx="'+geo.cx+'" cy="'+geo.cy+'" r="'+geo.r+'" fill="#000"/>';
      }
      cropBox.innerHTML=
        '<svg viewBox="0 0 '+side+' '+side+'" preserveAspectRatio="xMidYMid slice">'+
          '<defs><mask id="k-cm" maskUnits="userSpaceOnUse" x="0" y="0" width="'+side+'" height="'+side+'">'+
            '<rect x="0" y="0" width="'+side+'" height="'+side+'" fill="#fff"/>'+
            '<g transform="translate('+(side/2)+','+(side/2)+') scale('+k+') translate('+(-cx)+','+(-cy)+')">'+
              hole+
            '</g>'+
          '</mask></defs>'+
          '<image href="'+photo.getAttribute('src')+'" x="'+(side/2-cx*k)+'" y="'+(side/2-cy*k)+
            '" width="'+(IMG_W*k)+'" height="'+(IMG_H*k)+'" preserveAspectRatio="none"/>'+
          '<rect x="0" y="0" width="'+side+'" height="'+side+'" fill="rgba(3,5,10,.66)" mask="url(#k-cm)"/>'+
        '</svg>';
      cropBox.style.display='';
    } else {
      cropBox.innerHTML='';
      cropBox.style.display='none';
    }

    // The words. Built from the same table the language switch uses, so both
    // languages are already here and nothing is fetched.
    readTitle.textContent = txt ? txt[LANG].label : '';
    readBody.textContent='';
    if(txt) txt[LANG].body.forEach(function(s){
      var el=document.createElement('p'); el.textContent=s; readBody.appendChild(el);
    });
    readBox.classList.add('show');
    allBox.classList.add('show');
  }

  /**
   * Fit each name's plate to the name. Only the browser knows how wide a
   * string renders, and a guess from character counts is wrong as soon as the
   * two scripts mix — so measure, here and again after a language switch.
   */
  /**
   * Keep the name plates off each other.
   *
   * They are opaque now, so where two overlap the lower one is not merely
   * crowded, it is gone — and so is the picture underneath. First nudge them
   * apart vertically, which reads as a stack and keeps each one near its own
   * number. Where that is not enough, drop the name belonging to the larger
   * structure: a nebula-wide ring is recognisable without a caption, a pillar
   * forty pixels across is not. Nothing is lost either way — coming near still
   * brings the name back, and the list has every one of them.
   */
  function layoutLabels(){
    var items=[];
    GEO.forEach(function(e){
      if(!e.label) return;
      e.label.removeAttribute('transform');
      e.label.classList.remove('crowded');
      var r=e.label.querySelector('rect');
      if(!r || !r.getAttribute('width')) return;
      items.push({ el:e.label, size:e.size===undefined?Infinity:e.size, dy:0,
                   x:+r.getAttribute('x'), y:+r.getAttribute('y'),
                   w:+r.getAttribute('width'), h:+r.getAttribute('height') });
    });
    var overlap=function(a,b){
      return a.x < b.x+b.w && b.x < a.x+a.w &&
             a.y+a.dy < b.y+b.dy+b.h && b.y+b.dy < a.y+a.dy+a.h;
    };
    for(var pass=0; pass<24; pass++){
      var moved=false;
      for(var i=0;i<items.length;i++){
        for(var j=i+1;j<items.length;j++){
          var a=items[i], b=items[j];
          if(!overlap(a,b)) continue;
          // Push the bigger feature's plate out of the smaller one's way.
          var lower = a.size>=b.size ? a : b, other = lower===a ? b : a;
          var need = (other.y+other.dy+other.h) - (lower.y+lower.dy) + a.h*0.25;
          var up = (lower.y+lower.dy) - (other.y+other.dy+other.h) - a.h*0.25;
          lower.dy += Math.abs(need) < Math.abs(up) ? need : up;
          moved=true;
        }
      }
      if(!moved) break;
    }
    items.forEach(function(it){
      // A plate dragged far from its own number stops belonging to it.
      if(Math.abs(it.dy) > it.h*2.5) it.dy=0;
      if(it.dy) it.el.setAttribute('transform','translate(0,'+Math.round(it.dy)+')');
    });
    // Whatever still collides after that: the larger one gives up its name.
    for(var i2=0;i2<items.length;i2++){
      for(var j2=i2+1;j2<items.length;j2++){
        if(!overlap(items[i2],items[j2])) continue;
        (items[i2].size>=items[j2].size ? items[i2] : items[j2]).el.classList.add('crowded');
      }
    }
  }

  function fitPlates(){
    document.querySelectorAll('.k-label').forEach(function(g){
      var txt=g.querySelector('text');
      var rect=g.querySelector('rect');
      if(!txt||!rect) return;
      var b;
      try { b=txt.getBBox(); } catch(e) { return; }
      if(!b.width) return;
      var padX=b.height*0.38, padY=b.height*0.22;
      rect.setAttribute('x', b.x-padX);
      rect.setAttribute('y', b.y-padY);
      rect.setAttribute('width', b.width+padX*2);
      rect.setAttribute('height', b.height+padY*2);
    });
  }

  document.querySelectorAll('.k-feat').forEach(function(g){
    var id=g.getAttribute('data-f');
    function pick(e){ e.preventDefault(); e.stopPropagation(); show(id); }
    g.addEventListener('click', pick);
    g.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' ') pick(e); });
  });

  // Coming near is the interaction. Hit-testing is done here rather than with
  // pointerenter on each shape because a touch drag captures its pointer to
  // whatever was under the finger when it went down — the events never reach
  // the shapes it slides over, so a finger sweeping the picture would stay
  // stuck on the first thing it touched.
  var leaveTimer=null;
  // Long enough to look away and back, short enough that the crop does not
  // camp on the picture once you have moved on.
  var LINGER=3000;

  /**
   * Proximity, measured.
   *
   * The first try asked the browser what was under the pointer, which cannot
   * answer this: reach areas overlap, and a line's band is equally wide along
   * its whole length, so whichever one happened to be on top blanketed its
   * neighbours — on a 15-mark frame a pillar could not be hit on a single one
   * of its own 167 vertices. Distance to the actual geometry is the thing the
   * interaction is named after, so measure that and take the nearest.
   *
   * The geometry is read back out of the DOM rather than shipped again: it is
   * already in the page as the shapes themselves.
   */
  var GEO=[];
  document.querySelectorAll('.k-feat').forEach(function(g){
    var h=g.querySelector('.k-geo');
    var b=g.querySelector('.k-badge');
    var e={ id:g.getAttribute('data-f'), badge:b };
    if(h && h.points && h.points.length){
      e.pts=[]; for(var i=0;i<h.points.length;i++) e.pts.push([h.points[i].x, h.points[i].y]);
      e.closed = h.tagName.toLowerCase()==='polygon';
      var xs=e.pts.map(function(q){return q[0];}), ys=e.pts.map(function(q){return q[1];});
      e.size=Math.max(Math.max.apply(null,xs)-Math.min.apply(null,xs),
                      Math.max.apply(null,ys)-Math.min.apply(null,ys))/2;
    } else if(h){
      e.cx=+h.getAttribute('cx'); e.cy=+h.getAttribute('cy'); e.r=+h.getAttribute('r');
      e.hollow = h.getAttribute('fill')==='none';
      e.size=e.r;
    }
    e.label=g.querySelector('.k-label');
    GEO.push(e);
  });

  /**
   * Distance from the pointer to a rectangle, in screen pixels. Boxes come
   * straight from the DOM at the moment of asking rather than from anything
   * cached: the names move when they are laid out, change width with the
   * language, and shift again whenever the picture is resized, and a stale
   * copy of where they used to be is a pointer that answers the wrong mark.
   */
  function rectDist(r, x, y){
    var dx=Math.max(r.left-x, 0, x-r.right);
    var dy=Math.max(r.top-y, 0, y-r.bottom);
    return Math.sqrt(dx*dx+dy*dy);
  }

  /**
   * How much slack counts as "near", in screen pixels rather than image ones.
   * The picture may be four thousand pixels wide or eight hundred; what has to
   * stay constant is the gap under somebody's finger.
   */
  var REACH=44;

  function at(x, y){
    var best=null, bestD=REACH;
    for(var i=0;i<GEO.length;i++){
      var e=GEO[i];
      var d=rectDist(e.badge.getBoundingClientRect(), x, y);
      // A dropped name is not on the screen, so it cannot be aimed at.
      if(e.label && !e.label.classList.contains('crowded')){
        d=Math.min(d, rectDist(e.label.getBoundingClientRect(), x, y));
      }
      if(d<bestD){ bestD=d; best=e.id; }
    }
    return best;
  }

  function near(x, y){
    var id=at(x, y);
    clearTimeout(leaveTimer);
    if(id){ if(id!==active) show(id); return; }
    // Don't drop it the instant the pointer crosses a gap: moving between two
    // neighbouring marks would flicker the whole screen.
    leaveTimer=setTimeout(function(){ if(!active) return; show(null); }, LINGER);
  }
  stage.addEventListener('pointermove', function(e){ near(e.clientX, e.clientY); }, {passive:true});
  stage.addEventListener('pointerdown', function(e){ near(e.clientX, e.clientY); }, {passive:true});
  // Leaving the picture sends no more moves, so without this the crop would
  // stay up until the idle reset — minutes later.
  stage.addEventListener('pointerleave', function(){
    clearTimeout(leaveTimer);
    leaveTimer=setTimeout(function(){ if(active) show(null); }, LINGER);
  }, {passive:true});
  // Tapping a title toggles it, so the list works on its own without the picture.
  document.querySelectorAll('.k-card-head').forEach(function(h){
    h.addEventListener('click', function(){
      var id=h.getAttribute('data-f');
      show(active===id ? null : id);
    });
  });


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
      showRead(active); // the photo just changed size under it
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
    if(active) showRead(active);   // the panel holds a copy of the words
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
    fitPlates(); layoutLabels();
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

  showRead(null); // the subject, until somebody asks about something else

  // Plates are measured, so they wait for the fonts the measurement depends on.
  fitPlates(); layoutLabels();
  if(document.fonts && document.fonts.ready)
    document.fonts.ready.then(function(){ fitPlates(); layoutLabels(); });
  // The crop is sized from the photo's box, which a resize or a dragged
  // divider changes underneath it.
  window.addEventListener('resize', function(){ showRead(active); });
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
