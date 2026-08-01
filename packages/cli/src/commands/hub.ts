import express from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  AstrolensConfig,
  BUILTIN_PROFILES,
  profileNames,
  resolveProfile,
  type Profile,
} from '@astrolens/schema';
import { loadConfig, userConfigPath } from '@astrolens/schema/node';
import { offlineCatalogStatus, isOfflineReady, catalogCacheStatus } from '@astrolens/identify';

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
  profileName: string;
  profile: Profile;
  catalogsReady: boolean;
  snapshotFields: number;
}): string {
  const mode = `${o.profile.solve.mode === 'local' ? '本地解析' : 'nova 在线解析'} · ${
    o.profile.reading.mode === 'ai' ? 'AI 解读' : '预定义解读'
  }`;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>astrolens</title><style>${SHELL}</style></head><body><div class="wrap">
<h1>astrolens</h1>
<p class="sub">当前配置档 <b>${esc(o.profileName)}</b> — ${esc(mode)}
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
  file: AstrolensConfig;
  profileName: string;
  profile: Profile;
  profiles: string[];
  catalogs: { key: string; present: boolean }[];
  snapshotFields: number;
}): string {
  const p = o.profile;
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
  <label>配置档
    <select name="activeProfile">${o.profiles
      .map((n) => opt(n, o.profileName, n === 'studio' ? 'studio — 工作台' : n === 'kiosk' ? 'kiosk — 现场' : n))
      .join('')}</select>
  </label>
  <p class="hint">下面改的是<b>当前选中这一档</b>的设置。</p>

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
    <div class="check"><input type="checkbox" name="reading.switchableInKiosk" ${p.reading.switchableInKiosk ? 'checked' : ''}>
      <span>现场页面上可以切换讲解风格</span></div>
  </fieldset>

  <fieldset><legend>取舍 Selection</legend>
    <div class="check"><input type="checkbox" name="select.dropContext" ${p.select.dropContext ? 'checked' : ''}>
      <span>丢掉次要的陪衬天体(宁缺毋滥)</span></div>
    <div class="check"><input type="checkbox" name="select.requireAtlasForB" ${p.select.requireAtlasForB ? 'checked' : ''}>
      <span>只画标注库里已审核的形态特征</span></div>
  </fieldset>

  <button type="submit">保存</button>
  <p class="status" id="st"></p>
</form>
<script>
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

/** Apply a flat `section.key` form body onto the profile's stored deltas. */
function applySettings(file: AstrolensConfig, body: Record<string, unknown>): AstrolensConfig {
  const name = String(body['activeProfile'] ?? file.activeProfile);
  const patch: Record<string, Record<string, unknown>> = {
    ...(JSON.parse(JSON.stringify(file.profiles[name] ?? {})) as Record<
      string,
      Record<string, unknown>
    >),
  };
  const set = (section: string, key: string, value: unknown): void => {
    patch[section] = { ...(patch[section] ?? {}), [key]: value };
  };
  for (const [k, v] of Object.entries(body)) {
    if (k === 'activeProfile' || k === 'catalog.preset') continue;
    const [section, key] = k.split('.');
    if (!section || !key) continue;
    set(section, key, v);
  }
  // The catalog choice is a preset, not a raw list — a settings page is the
  // wrong place to ask someone to compose a source array by hand.
  if (body['catalog.preset'] === 'offline') {
    set('catalog', 'sources', ['offline', 'snapshot']);
    set('catalog', 'snapshotOnly', true);
  } else if (body['catalog.preset'] === 'online') {
    set('catalog', 'sources', ['simbad', 'vizier', 'openngc']);
    set('catalog', 'snapshotOnly', false);
  }
  return AstrolensConfig.parse({
    version: 1,
    activeProfile: name,
    profiles: { ...file.profiles, [name]: patch },
  });
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
    cfg: ReturnType<typeof loadConfig>;
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
        profileName: s.cfg.profileName,
        profile: s.cfg.profile,
        catalogsReady: s.ready,
        snapshotFields: s.snapshotFields,
      }),
    );
  });

  app.get('/settings', async (_req, res) => {
    const s = await state();
    res.type('html').send(
      settingsPage({
        file: s.cfg.file,
        profileName: s.cfg.profileName,
        profile: s.cfg.profile,
        profiles: profileNames(s.cfg.file),
        catalogs: s.catalogs,
        snapshotFields: s.snapshotFields,
      }),
    );
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const cfg = loadConfig();
      const next = applySettings(cfg.file, req.body as Record<string, unknown>);
      // Round-trip through resolveProfile so a bad combination fails here,
      // with the form still on screen, rather than at the next solve.
      resolveProfile(next, next.activeProfile);
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
  console.log(`  配置档 ${loadConfig().profileName}(内置:${Object.keys(BUILTIN_PROFILES).join(' / ')})`);
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
