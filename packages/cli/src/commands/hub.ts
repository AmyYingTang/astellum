import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AstrolensConfig, PartialConfig, mergeConfig } from '@astrolens/schema';
import { loadConfig, userConfigPath } from '@astrolens/schema/node';
import {
  offlineCatalogStatus,
  isOfflineReady,
  catalogCacheStatus,
  bandsForField,
  indexUrls,
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
}): string {
  const mode = `${o.config.solve.mode === 'local' ? '本地解析' : 'nova 在线解析'} · ${
    o.config.reading.mode === 'ai' ? 'AI 解读' : '预定义解读'
  }`;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>astrolens</title><style>${SHELL}</style></head><body><div class="wrap">
<h1>astrolens</h1>
<p class="sub">${esc(mode)}
  <span class="badge ${o.catalogsReady ? 'ok' : 'warn'}">${
    o.catalogsReady ? '离线星表齐全' : '离线星表不全'
  }</span></p>
<div class="grid">
  <a class="card" href="http://localhost:${o.studio}/">
    <h2>工作台 Studio</h2>
    <p>做一张图:上传、识别、微调标注、AI 写解读、导出海报。每个环节都能改。</p>
    <span class="port">localhost:${o.studio}</span>
  </a>
  <a class="card" href="http://localhost:${o.atlas}/">
    <h2>基准标注库 Atlas</h2>
    <p>画并审核 B 类形态标注。这里的标注会按天球坐标转移到任何一张同目标的图上。</p>
    <span class="port">localhost:${o.atlas}</span>
  </a>
  <a class="card" href="http://localhost:${o.kiosk}/">
    <h2>现场 Kiosk</h2>
    <p>选一张图(FITS/JPG/PNG),几秒后出一张全屏可点的页面给观众看。可离线。</p>
    <span class="port">localhost:${o.kiosk}</span>
  </a>
  <a class="card" href="/settings">
    <h2>设置 Settings</h2>
    <p>解析器用本地还是在线、解读用 AI 还是预定义、离线数据是否就绪。</p>
    <span class="port">${o.snapshotFields} 片天区已预热</span>
  </a>
</div>
</div></body></html>`;
}

function settingsPage(o: {
  config: AstrolensConfig;
  catalogs: { key: string; present: boolean }[];
  snapshotFields: number;
}): string {
  const p = o.config;
  const opt = (v: string, cur: string, label: string): string =>
    `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>设置 · astrolens</title><style>${SHELL}</style></head><body><div class="wrap">
<a class="back" href="/">← 返回导航</a>
<h1>设置</h1>
<p class="sub">写入 <code>${esc(userConfigPath())}</code>。环境变量(<code>.env</code>)仍然优先级最高,
所以那里设过的项在这里改了也不会生效。</p>
<form id="f">

  <fieldset><legend>解析 Plate solving</legend>
    <label>解析器
      <select name="solve.mode">
        ${opt('local', p.solve.mode, '本地 astrometry.net(离线,需索引文件)')}
        ${opt('nova', p.solve.mode, 'nova.astrometry.net(在线,需 API key)')}
      </select>
    </label>
    <div class="check"><input type="checkbox" name="solve.cache" ${p.solve.cache ? 'checked' : ''}>
      <span>缓存解析结果(同一张图只解一次)</span></div>
    <div class="check"><input type="checkbox" name="solve.hintFromTarget" ${p.solve.hintFromTarget ? 'checked' : ''}>
      <span>已知目标时给解析器位置提示(现场提速明显)</span></div>
  </fieldset>

  <fieldset><legend>目录 Catalogs</legend>
    <label>数据来源
      <select name="catalog.preset">
        ${opt('online', p.catalog.sources.includes('simbad') ? 'online' : 'offline', '在线:SIMBAD + VizieR + OpenNGC')}
        ${opt('offline', p.catalog.sources.includes('simbad') ? 'online' : 'offline', '离线:本地星表包 + 快照')}
      </select>
    </label>
    <table>${o.catalogs
      .map((c) => `<tr><td>${esc(c.key)}</td><td>${c.present ? '✓' : '缺失'}</td></tr>`)
      .join('')}
      <tr><td>在线答案快照</td><td>${o.snapshotFields} 片天区</td></tr></table>
    <p class="hint">缺失的用 <code>./quickastrolens prefetch</code> 下载。</p>
  </fieldset>

  <fieldset id="idx"${p.solve.mode === 'local' ? '' : ' style="display:none"'}><legend>解析索引 Plate-solve indexes</legend>
    <p class="hint">只有本地解析需要。大小完全由<b>你要支持的最小视场</b>决定
      —— 越窄的视场需要越细的索引档,而每细一档大小翻倍。</p>
    <div id="idx-state" class="hint">读取中…</div>
    <label>最小视场(角分)
      <select id="idx-arcmin"></select>
    </label>
    <label>存放目录
      <input type="text" id="idx-dir" placeholder="~/astrometry-indexes">
    </label>
    <p class="hint">下载后需要让解析器知道这个目录:
      <code>echo "add_path &lt;目录&gt;" &gt;&gt; "$(brew --prefix)/etc/astrometry.cfg"</code></p>
    <button type="button" id="idx-go">下载索引</button>
    <p class="status" id="idx-status"></p>
  </fieldset>

  <fieldset><legend>解读 Reading</legend>
    <label>文字来源
      <select name="reading.mode">
        ${opt('ai', p.reading.mode, 'AI 生成(需联网 + claude CLI)')}
        ${opt('predefined', p.reading.mode, '预定义解读库(离线)')}
      </select>
    </label>
    <label>预定义风格<input type="text" name="reading.style" value="${esc(p.reading.style)}"></label>
    <div class="check"><input type="checkbox" name="reading.customPrompt" ${p.reading.customPrompt ? 'checked' : ''}>
      <span>工作台里保留自定义 prompt 输入框</span></div>
    <div class="check"><input type="checkbox" name="kiosk.switchableStyle" ${p.kiosk.switchableStyle ? 'checked' : ''}>
      <span>现场页面上可以切换讲解风格</span></div>
  </fieldset>

  <fieldset><legend>现场展示 Kiosk</legend>
    <div class="check"><input type="checkbox" name="kiosk.dropContext" ${p.kiosk.dropContext ? 'checked' : ''}>
      <span>丢掉次要的陪衬天体(宁缺毋滥)</span></div>
    <div class="check"><input type="checkbox" name="kiosk.requireAtlasForB" ${p.kiosk.requireAtlasForB ? 'checked' : ''}>
      <span>只画标注库里已审核的形态特征</span></div>
  </fieldset>

  <button type="submit">保存</button>
  <p class="status" id="st"></p>
</form>
<script>
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
      op.value=o.arcmin; op.textContent=o.arcmin+'′ 以上的视场 — 约 '+mb(o.mb);
      idxSel.appendChild(op);
    });
    idxSel.value='60';
  }
  if(!idxDir.value) idxDir.value=j.dir;
  idxState.textContent = j.onDisk
    ? '已有 '+j.onDisk+' 个索引文件,'+j.gb.toFixed(2)+' GB — '+j.dir
    : '还没有索引文件 — '+j.dir;
  var job=j.job;
  if(job){
    var pct=job.total?Math.round((job.done+job.skipped)/job.total*100):0;
    idxStatus.className='status';
    idxStatus.textContent = job.running
      ? '下载中 '+pct+'%('+(job.done+job.skipped)+'/'+job.total+')'+(job.current?' · '+job.current:'')
      : '完成:新下载 '+job.done+',已存在 '+job.skipped+(job.failed?',失败 '+job.failed:'');
    if(job.failed && !job.running) idxStatus.className='status err';
    idxGo.disabled=job.running;
    if(!job.running && idxTimer){ clearInterval(idxTimer); idxTimer=null; }
  }
}
idxGo.addEventListener('click', async function(){
  idxGo.disabled=true;
  idxStatus.className='status'; idxStatus.textContent='启动中…';
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
  st.className='status'; st.textContent='保存中…';
  var r=await fetch('/api/settings',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(body)});
  var j=await r.json();
  if(j.ok){ st.className='status ok'; st.textContent='已保存。重启相关页面后生效。'; }
  else { st.className='status err'; st.textContent=j.error||'保存失败'; }
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

  app.get('/', async (_req, res) => {
    const s = await state();
    res.type('html').send(
      navPage({
        studio: studioPort,
        atlas: atlasPort,
        kiosk: kioskPort,
        config: s.cfg,
        catalogsReady: s.ready,
        snapshotFields: s.snapshotFields,
      }),
    );
  });

  app.get('/settings', async (_req, res) => {
    const s = await state();
    res.type('html').send(
      settingsPage({
        config: s.cfg,
        catalogs: s.catalogs,
        snapshotFields: s.snapshotFields,
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
        try {
          const st = await stat(dest);
          if (st.size > 0) {
            job.skipped += 1;
            continue;
          }
        } catch {
          // not downloaded yet
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
