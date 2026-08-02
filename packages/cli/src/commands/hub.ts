import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AstrolensConfig, PartialConfig, mergeConfig, preferredLang } from '@astrolens/schema';
import { loadConfig, userConfigPath } from '@astrolens/schema/node';
import {
  offlineCatalogStatus,
  isOfflineReady,
  catalogCacheStatus,
  bandsForField,
  indexUrls,
  isComplete,
  indexChoices,
} from '@astrolens/identify';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

/**
 * The front door for the whole tool.
 *
 * There are three quite different surfaces here — the studio where a frame is
 * made, the atlas where the baseline annotations live, and the kiosk that shows
 * a frame to an audience — and until now the only way in was to know which
 * command started which. This is one page that says what they are and hands you
 * to the right one, plus the settings that used to be environment variables.
 *
 * Each surface still runs as its own server on its own port and can be started
 * on its own; the hub launches them and passes its own address down, so each
 * one can offer a way back.
 */

export interface HubArgs {
  port?: number;
  studioPort?: number;
  atlasPort?: number;
  kioskPort?: number;
  atlasDataDir?: string;
  workspace?: string;
  open?: boolean;
  /** Land on the settings page instead of the nav page. */
  settings?: boolean;
}

interface Child {
  name: string;
  port: number;
  proc: ChildProcess;
}

/** Index downloads are measured in gigabytes, so they run in the background and
 *  the page polls. Kept in memory: a half-finished download is resumable from
 *  what is already on disk, so there is nothing worth persisting. */
interface IndexJob {
  running: boolean;
  total: number;
  done: number;
  skipped: number;
  failed: number;
  mb: number;
  current: string;
  dir: string;
  error?: string;
}

/**
 * The hub is server-rendered, so the language is resolved per request rather
 * than shipped twice into the page: a saved cookie if there is one, otherwise
 * what the browser asked for. The toggle sets the cookie and reloads — cheap
 * on a static page, and it keeps every label, placeholder and option in one
 * language without threading a second copy through the markup.
 */
type Lang = 'zh' | 'en';

function langFor(req: { headers: Record<string, unknown> }): Lang {
  const cookie = String(req.headers['cookie'] ?? '');
  const saved = /(?:^|;\s*)astrolens_lang=(zh|en)/.exec(cookie)?.[1];
  if (saved === 'zh' || saved === 'en') return saved;
  const accept = String(req.headers['accept-language'] ?? '');
  return preferredLang(accept.split(',').map((p) => p.split(';')[0]!.trim()).filter(Boolean));
}

/** Pick one of a bilingual pair. */
const T = (lang: Lang) => (zh: string, en: string): string => (lang === 'zh' ? zh : en);

/** Flip the cookie and reload. A page this static costs nothing to re-render,
 *  and it keeps one language in the markup instead of two. */
const LANG_SCRIPT = `<script>
function astroLang(){
  var cur=(document.cookie.match(/astrolens_lang=(zh|en)/)||[])[1]
        || (document.documentElement.lang==='zh'?'zh':'en');
  var next=cur==='zh'?'en':'zh';
  document.cookie='astrolens_lang='+next+';path=/;max-age=31536000';
  location.reload();
}
</script>`;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SHELL = `
*{box-sizing:border-box;margin:0;padding:0;}
body{min-height:100vh;background:#05070c;color:#e6e9f0;padding:40px 24px;
  font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
.wrap{max-width:900px;margin:0 auto;}
h1{font-size:28px;font-weight:700;}
.sub{margin-top:8px;color:#8a93a8;font-size:14px;line-height:1.7;}
.grid{margin-top:28px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));}
.card{display:block;background:#0b0f18;border:1px solid #1e2637;border-radius:14px;
  padding:22px;text-decoration:none;color:inherit;transition:border-color .15s,background .15s;}
.card:hover{border-color:#3a4a6b;background:#0e131e;}
.card h2{font-size:18px;font-weight:700;}
.card p{margin-top:8px;color:#8a93a8;font-size:13.5px;line-height:1.7;}
.card .port{margin-top:12px;display:inline-block;color:#5d6780;font-size:12px;}
.badge{display:inline-block;font-size:11.5px;border:1px solid #2a3346;border-radius:999px;
  padding:3px 9px;color:#8a93a8;margin-left:8px;vertical-align:middle;}
.badge.ok{color:#9ece6a;border-color:#35502a;}
.badge.warn{color:#e0af68;border-color:#5c471f;}
a.back{display:inline-block;margin-bottom:20px;color:#8a93a8;text-decoration:none;font-size:14px;}
a.back:hover{color:#cfd6e4;}
.lang{position:absolute;right:24px;top:32px;background:#141925;border:1px solid #2a3346;
  color:#cfd6e4;border-radius:9px;padding:7px 13px;font-size:13px;cursor:pointer;}
.lang:hover{background:#1c2333;}
.wrap{position:relative;}
label{display:block;margin-top:18px;font-size:13px;color:#8a93a8;}
select,input[type=text]{width:100%;margin-top:7px;background:#141925;border:1px solid #2a3346;
  color:#e6e9f0;border-radius:10px;padding:11px 13px;font-size:15px;}
fieldset{margin-top:26px;border:1px solid #1e2637;border-radius:12px;padding:18px 20px 22px;}
legend{padding:0 8px;color:#cfd6e4;font-size:14px;font-weight:600;}
.hint{margin-top:6px;color:#5d6780;font-size:12.5px;line-height:1.6;}
.check{display:flex;align-items:center;gap:9px;margin-top:14px;color:#cfd6e4;font-size:14px;}
button{margin-top:26px;background:#2b6cb0;border:0;color:#fff;border-radius:11px;
  padding:13px 26px;font-size:16px;font-weight:600;cursor:pointer;}
.status{margin-top:14px;font-size:13px;color:#8a93a8;min-height:18px;}
.status.ok{color:#9ece6a;}
.status.err{color:#f7768e;}
table{width:100%;margin-top:10px;border-collapse:collapse;font-size:13px;}
td{padding:6px 0;border-bottom:1px solid #161d2b;color:#9aa4bb;}
td:last-child{text-align:right;color:#cfd6e4;}
`;

function navPage(o: {
  studio: number;
  atlas: number;
  kiosk: number;
  config: AstrolensConfig;
  catalogsReady: boolean;
  snapshotFields: number;
  lang: Lang;
}): string {
  const t = T(o.lang);
  const mode =
    `${o.config.solve.mode === 'local' ? t('本地解析', 'local solving') : t('nova 在线解析', 'nova (online)')}` +
    ` · ${o.config.reading.mode === 'ai' ? t('AI 解读', 'AI readings') : t('预定义解读', 'predefined readings')}`;
  return `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>astrolens</title><style>${SHELL}</style></head><body><div class="wrap">
<button class="lang" onclick="astroLang()">${o.lang === 'zh' ? 'EN' : '中文'}</button>
<h1>astrolens</h1>
<p class="sub">${esc(mode)}
  <span class="badge ${o.catalogsReady ? 'ok' : 'warn'}">${
    o.catalogsReady
      ? t('离线星表齐全', 'offline catalogues ready')
      : t('离线星表不全', 'offline catalogues incomplete')
  }</span></p>
<div class="grid">
  <a class="card" href="http://localhost:${o.studio}/">
    <h2>${t('工作台 Studio', 'Studio')}</h2>
    <p>${t(
      '做一张图:上传、识别、微调标注、AI 写解读、导出海报。每个环节都能改。',
      'Make a frame: upload, identify, adjust the annotations, have the AI write it up, export a poster. Every stage is adjustable.',
    )}</p>
    <span class="port">localhost:${o.studio}</span>
  </a>
  <a class="card" href="http://localhost:${o.atlas}/">
    <h2>${t('基准标注库 Atlas', 'Feature atlas')}</h2>
    <p>${t(
      '画并审核 B 类形态标注。这里的标注会按天球坐标转移到任何一张同目标的图上。',
      'Draw and review the baseline annotations. Stored in sky coordinates, they project onto any future image of the same target.',
    )}</p>
    <span class="port">localhost:${o.atlas}</span>
  </a>
  <a class="card" href="http://localhost:${o.kiosk}/">
    <h2>${t('现场 Kiosk', 'Kiosk')}</h2>
    <p>${t(
      '选一张图(FITS/JPG/PNG),几秒后出一张全屏可点的页面给观众看。可离线。',
      'Pick an image (FITS/JPG/PNG) and get a fullscreen page an audience can touch. Works offline.',
    )}</p>
    <span class="port">localhost:${o.kiosk}</span>
  </a>
  <a class="card" href="/settings">
    <h2>${t('设置 Settings', 'Settings')}</h2>
    <p>${t(
      '解析器用本地还是在线、解读用 AI 还是预定义、离线数据是否就绪。',
      'Local or online solving, AI or predefined readings, and whether the offline data is ready.',
    )}</p>
    <span class="port">${
      o.lang === 'zh'
        ? `${o.snapshotFields} 片天区已预热`
        : `${o.snapshotFields} field(s) prewarmed`
    }</span>
  </a>
</div>
${LANG_SCRIPT}
</div></body></html>`;
}

function settingsPage(o: {
  config: AstrolensConfig;
  catalogs: { key: string; present: boolean }[];
  snapshotFields: number;
  lang: Lang;
}): string {
  const p = o.config;
  const t = T(o.lang);
  const opt = (v: string, cur: string, label: string): string =>
    `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const check = (name: string, on: boolean, label: string): string =>
    `<div class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span>${esc(label)}</span></div>`;
  return `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t('设置', 'Settings')} · astrolens</title><style>${SHELL}</style></head><body><div class="wrap">
<button class="lang" onclick="astroLang()">${o.lang === 'zh' ? 'EN' : '中文'}</button>
<a class="back" href="/">← ${t('返回导航', 'Back')}</a>
<h1>${t('设置', 'Settings')}</h1>
<p class="sub">${t('写入', 'Written to')} <code>${esc(userConfigPath())}</code>${t('。', '. ')}${t(
    '环境变量(.env)仍然优先级最高,所以那里设过的项在这里改了也不会生效。',
    'Environment variables (.env) still win, so anything set there will not take effect here.',
  )}</p>
<form id="f">
  <fieldset><legend>${t('解析 Plate solving', 'Plate solving')}</legend>
    <label>${t('解析器', 'Solver')}
      <select name="solve.mode">
        ${opt('local', p.solve.mode, t('本地 astrometry.net(离线,需索引文件)', 'Local astrometry.net (offline, needs index files)'))}
        ${opt('nova', p.solve.mode, t('nova.astrometry.net(在线,需 API key)', 'nova.astrometry.net (online, needs an API key)'))}
      </select>
    </label>
    ${check('solve.cache', p.solve.cache, t('缓存解析结果(同一张图只解一次)', 'Cache solves (each image is solved once)'))}
    ${check('solve.hintFromTarget', p.solve.hintFromTarget, t('已知目标时给解析器位置提示(现场提速明显)', 'Hint the solver with a known target position (much faster in the field)'))}
  </fieldset>

  <fieldset><legend>${t('目录 Catalogs', 'Catalogues')}</legend>
    <label>${t('数据来源', 'Source')}
      <select name="catalog.preset">
        ${opt('online', p.catalog.sources.includes('simbad') ? 'online' : 'offline', t('在线:SIMBAD + VizieR + OpenNGC', 'Online: SIMBAD + VizieR + OpenNGC'))}
        ${opt('offline', p.catalog.sources.includes('simbad') ? 'online' : 'offline', t('离线:本地星表包 + 快照', 'Offline: the local star-table pack + snapshot'))}
      </select>
    </label>
    <table>${o.catalogs
      .map((c) => `<tr><td>${esc(c.key)}</td><td>${c.present ? '✓' : t('缺失', 'missing')}</td></tr>`)
      .join('')}
      <tr><td>${t('在线答案快照', 'Answer snapshot')}</td><td>${
        o.lang === 'zh' ? `${o.snapshotFields} 片天区` : `${o.snapshotFields} field(s)`
      }</td></tr></table>
    <p class="hint">${t('缺失的用', 'Download what is missing with')} <code>./quickastrolens prefetch</code>${t(' 下载。', '.')}</p>
  </fieldset>

  <fieldset id="idx"${p.solve.mode === 'local' ? '' : ' style="display:none"'}><legend>${t('解析索引 Plate-solve indexes', 'Plate-solve indexes')}</legend>
    <p class="hint">${t(
      '只有本地解析需要。大小完全由你要支持的最小视场决定 —— 越窄的视场需要越细的索引档,而每细一档大小翻倍。',
      'Needed only for local solving. The size is decided entirely by the narrowest field you must solve — each finer band is about twice the size of the one above it.',
    )}</p>
    <div id="idx-state" class="hint">${t('读取中…', 'Reading…')}</div>
    <label>${t('最小视场(角分)', 'Narrowest field (arcmin)')}
      <select id="idx-arcmin"></select>
    </label>
    <label>${t('存放目录', 'Directory')}
      <input type="text" id="idx-dir" placeholder="~/astrometry-indexes">
    </label>
    <p class="hint">${t('下载后需要让解析器知道这个目录:', 'Point the solver at it afterwards:')}
      <code>echo "add_path &lt;dir&gt;" &gt;&gt; "$(brew --prefix)/etc/astrometry.cfg"</code></p>
    <button type="button" id="idx-go">${t('下载索引', 'Download indexes')}</button>
    <p class="status" id="idx-status"></p>
  </fieldset>

  <fieldset><legend>${t('解读 Reading', 'Reading')}</legend>
    <label>${t('文字来源', 'Written by')}
      <select name="reading.mode">
        ${opt('ai', p.reading.mode, t('AI 生成(需联网 + claude CLI)', 'The LLM (needs a network and the claude CLI)'))}
        ${opt('predefined', p.reading.mode, t('预定义解读库(离线)', 'The predefined library (offline)'))}
      </select>
    </label>
    <label>${t('预定义风格', 'Predefined style')}<input type="text" name="reading.style" value="${esc(p.reading.style)}"></label>
    ${check('reading.customPrompt', p.reading.customPrompt, t('工作台里保留自定义 prompt 输入框', "Keep the studio's free-text prompt box"))}
  </fieldset>

  <fieldset><legend>${t('现场展示 Kiosk', 'Kiosk')}</legend>
    ${check('kiosk.dropContext', p.kiosk.dropContext, t('丢掉次要的陪衬天体(宁缺毋滥)', 'Drop incidental context objects — few, confident labels'))}
    ${check('kiosk.requireAtlasForB', p.kiosk.requireAtlasForB, t('只画标注库里已审核的形态特征', 'Only draw features approved in the atlas'))}
    ${check('kiosk.switchableStyle', p.kiosk.switchableStyle, t('现场页面上可以切换讲解风格', 'Offer the reading-style switch on screen'))}
  </fieldset>

  <button type="submit">${t('保存', 'Save')}</button>
  <p class="status" id="st"></p>
</form>
${LANG_SCRIPT}
<script>
var IDX_T = ${JSON.stringify({
    have: t('已有', 'On disk:'),
    files: t('个索引文件', 'file(s)'),
    none: t('还没有索引文件', 'No index files yet'),
    over: t('′ 以上的视场 — 约 ', '′ and wider — about '),
    starting: t('启动中…', 'Starting…'),
    downloading: t('下载中', 'Downloading'),
    done: t('完成:新下载', 'Done: downloaded'),
    existed: t(',已存在', ', already present'),
    failed: t(',失败', ', failed'),
    saving: t('保存中…', 'Saving…'),
    saved: t('已保存。重启相关页面后生效。', 'Saved. Restart the affected page to pick it up.'),
    failedSave: t('保存失败', 'Save failed'),
  })};

// --- plate-solve indexes ---------------------------------------------------
var idxSel=document.getElementById('idx-arcmin'), idxDir=document.getElementById('idx-dir'),
    idxState=document.getElementById('idx-state'), idxStatus=document.getElementById('idx-status'),
    idxGo=document.getElementById('idx-go'), idxTimer=null;
function mb(n){ return n>=1024 ? (n/1024).toFixed(1)+' GB' : Math.round(n)+' MB'; }
async function idxRefresh(){
  var r=await fetch('/api/indexes'), j=await r.json();
  if(!idxSel.options.length){
    j.options.forEach(function(o){
      var op=document.createElement('option');
      op.value=o.arcmin; op.textContent=o.arcmin+IDX_T.over+mb(o.mb);
      idxSel.appendChild(op);
    });
    if([...idxSel.options].some(o=>o.value==='64')) idxSel.value='64';
  }
  if(!idxDir.value) idxDir.value=j.dir;
  idxState.textContent = j.onDisk
    ? IDX_T.have+' '+j.onDisk+' '+IDX_T.files+', '+j.gb.toFixed(2)+' GB — '+j.dir
    : IDX_T.none+' — '+j.dir;
  var job=j.job;
  if(job){
    var pct=job.total?Math.round((job.done+job.skipped)/job.total*100):0;
    idxStatus.className='status';
    idxStatus.textContent = job.running
      ? IDX_T.downloading+' '+pct+'% ('+(job.done+job.skipped)+'/'+job.total+')'+(job.current?' · '+job.current:'')
      : IDX_T.done+' '+job.done+IDX_T.existed+' '+job.skipped+(job.failed?IDX_T.failed+' '+job.failed:'');
    if(job.failed && !job.running) idxStatus.className='status err';
    idxGo.disabled=job.running;
    if(!job.running && idxTimer){ clearInterval(idxTimer); idxTimer=null; }
  }
}
idxGo.addEventListener('click', async function(){
  idxGo.disabled=true;
  idxStatus.className='status'; idxStatus.textContent=IDX_T.starting;
  var r=await fetch('/api/indexes',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({arcmin:Number(idxSel.value), dir:idxDir.value.trim()||undefined})});
  var j=await r.json();
  if(!j.ok){ idxStatus.className='status err'; idxStatus.textContent=j.error; idxGo.disabled=false; return; }
  if(!idxTimer) idxTimer=setInterval(idxRefresh, 1500);
  idxRefresh();
});
if(document.getElementById('idx').style.display!=='none') idxRefresh();

// Switching to local solving is exactly when someone needs the indexes, so the
// section appears the moment they choose it rather than after a save+reload.
document.querySelector('[name="solve.mode"]').addEventListener('change', function(e){
  var on = e.target.value==='local';
  document.getElementById('idx').style.display = on ? '' : 'none';
  if(on) idxRefresh();
});

document.getElementById('f').addEventListener('submit', async function(e){
  e.preventDefault();
  var f=new FormData(e.target), body={};
  new Set([...f.keys()]).forEach(function(k){ body[k]=f.get(k); });
  e.target.querySelectorAll('input[type=checkbox]').forEach(function(c){ body[c.name]=c.checked; });
  var st=document.getElementById('st');
  st.className='status'; st.textContent=IDX_T.saving;
  var r=await fetch('/api/settings',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(body)});
  var j=await r.json();
  if(j.ok){ st.className='status ok'; st.textContent=IDX_T.saved; }
  else { st.className='status err'; st.textContent=j.error||IDX_T.failedSave; }
});
</script>
</div></body></html>`;
}

/** Apply a flat `section.key` form body onto the stored config. */
function applySettings(current: AstrolensConfig, body: Record<string, unknown>): AstrolensConfig {
  const patch: Record<string, Record<string, unknown>> = {};
  const set = (section: string, key: string, value: unknown): void => {
    patch[section] = { ...(patch[section] ?? {}), [key]: value };
  };
  for (const [k, v] of Object.entries(body)) {
    if (k === 'catalog.preset') continue;
    const [section, key] = k.split('.');
    if (!section || !key) continue;
    set(section, key, v);
  }
  // The catalogue choice is a preset, not a raw list — a settings page is the
  // wrong place to ask someone to compose a source array by hand.
  if (body['catalog.preset'] === 'offline') {
    set('catalog', 'sources', ['offline', 'snapshot']);
    set('catalog', 'snapshotOnly', true);
  } else if (body['catalog.preset'] === 'online') {
    set('catalog', 'sources', ['simbad', 'vizier', 'openngc']);
    set('catalog', 'snapshotOnly', false);
  }
  return mergeConfig(current, PartialConfig.parse(patch));
}

function launch(name: string, args: string[], port: number, hubUrl: string): Child {
  const proc = spawn(process.execPath, [process.argv[1]!, ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ASTROLENS_HUB_URL: hubUrl, ASTROLENS_SUPERVISED: '1' },
  });
  return { name, port, proc };
}

export async function runHub(args: HubArgs = {}): Promise<void> {
  const port = args.port ?? 3000;
  const studioPort = args.studioPort ?? 3010;
  const atlasPort = args.atlasPort ?? 3100;
  const kioskPort = args.kioskPort ?? 3200;
  const hubUrl = `http://localhost:${port}/`;

  const children: Child[] = [
    launch(
      'studio',
      [
        'studio',
        '--port',
        String(studioPort),
        '--no-open',
        '--atlas-port',
        String(atlasPort),
        ...(args.workspace ? ['--workspace', args.workspace] : []),
        ...(args.atlasDataDir ? ['--atlas-data-dir', args.atlasDataDir] : []),
      ],
      studioPort,
      hubUrl,
    ),
    launch('kiosk', ['kiosk-serve', '--port', String(kioskPort), '--no-open'], kioskPort, hubUrl),
  ];
  // The studio already co-launches the atlas on --atlas-port; don't start a
  // second one on the same port.

  const shutdown = (): void => {
    for (const c of children) c.proc.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const state = async (): Promise<{
    cfg: AstrolensConfig;
    catalogs: { key: string; present: boolean }[];
    ready: boolean;
    snapshotFields: number;
  }> => {
    const cfg = loadConfig();
    const catalogs = await offlineCatalogStatus().catch(() => []);
    const snap = await catalogCacheStatus().catch(() => ({ entries: 0, bytes: 0, dir: '' }));
    return {
      cfg,
      catalogs: catalogs.map((c) => ({ key: c.key, present: c.present })),
      ready: catalogs.length ? isOfflineReady(catalogs) : false,
      snapshotFields: snap.entries,
    };
  };

  app.get('/', async (req, res) => {
    const s = await state();
    res.type('html').send(
      navPage({
        studio: studioPort,
        atlas: atlasPort,
        kiosk: kioskPort,
        config: s.cfg,
        catalogsReady: s.ready,
        snapshotFields: s.snapshotFields,
        lang: langFor(req),
      }),
    );
  });

  app.get('/settings', async (req, res) => {
    const s = await state();
    res.type('html').send(
      settingsPage({
        config: s.cfg,
        catalogs: s.catalogs,
        snapshotFields: s.snapshotFields,
        lang: langFor(req),
      }),
    );
  });

  // --- plate-solving indexes ---------------------------------------------
  // The only download here big enough to need a progress bar, and the only one
  // whose size is a decision rather than a constant.
  let indexJob: IndexJob | null = null;

  const runIndexDownload = async (arcmin: number, dir: string): Promise<void> => {
    const files = indexUrls(bandsForField(arcmin));
    indexJob = {
      running: true,
      total: files.length,
      done: 0,
      skipped: 0,
      failed: 0,
      mb: files.reduce((n, f) => n + f.mb, 0),
      current: '',
      dir,
    };
    const job = indexJob;
    try {
      await mkdir(dir, { recursive: true });
      for (const f of files) {
        job.current = f.file;
        const dest = join(dir, f.file);
        if (await isComplete(dest, f.url)) {
          job.skipped += 1;
          continue;
        }
        try {
          const r = await fetch(f.url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          await writeFile(dest, Buffer.from(await r.arrayBuffer()));
          job.done += 1;
        } catch {
          job.failed += 1;
        }
      }
    } catch (e) {
      job.error = (e as Error).message;
    } finally {
      job.running = false;
      job.current = '';
    }
  };

  app.get('/api/indexes', async (_req, res) => {
    const dir = process.env.ASTROMETRY_INDEX_DIR ?? join(homedir(), 'astrometry-indexes');
    let onDisk = 0;
    let bytes = 0;
    try {
      const { readdir } = await import('node:fs/promises');
      for (const n of await readdir(dir)) {
        if (!/^index-\d+/.test(n)) continue;
        onDisk += 1;
        bytes += (await stat(join(dir, n))).size;
      }
    } catch {
      // directory not created yet
    }
    res.json({
      dir,
      onDisk,
      gb: bytes / 1073741824,
      job: indexJob,
      // Generated from the band table: every option pulls a different set, so
      // there are never two choices that cost the same.
      options: indexChoices().map((c) => ({ arcmin: c.minFieldArcmin, mb: c.mb })),
    });
  });

  app.post('/api/indexes', (req, res) => {
    try {
      if (indexJob?.running) throw new Error('已经在下载了');
      const body = req.body as { arcmin?: number; dir?: string };
      const arcmin = Number(body.arcmin);
      if (!Number.isFinite(arcmin) || arcmin <= 0) throw new Error('请给一个有效的最小视场(角分)');
      const dir = (body.dir ?? '').trim() || join(homedir(), 'astrometry-indexes');
      void runIndexDownload(arcmin, dir);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const next = applySettings(loadConfig(), req.body as Record<string, unknown>);
      const path = userConfigPath();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  await new Promise<void>((ok) => app.listen(port, () => ok()));
  console.log(`astrolens: ${hubUrl}`);
  console.log(`  工作台 ${studioPort} · 标注库 ${atlasPort} · 现场 ${kioskPort}`);

  console.log('Ctrl+C 停止全部。');
  if (args.open !== false) {
    const cmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(cmd, [args.settings ? `${hubUrl}settings` : hubUrl], { stdio: 'ignore' }).unref();
  }
  await new Promise<void>(() => {
    /* run until interrupted */
  });
}
