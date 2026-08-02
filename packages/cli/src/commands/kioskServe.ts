import express from 'express';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '@astrolens/schema/node';
import { offlineCatalogStatus, isOfflineReady } from '@astrolens/identify';
import { KIOSK_FAVICON } from '@astrolens/renderer';
import { runKiosk } from './kiosk.js';
import { exitWhenOrphaned } from '../supervised.js';

/**
 * The kiosk's own front door.
 *
 * `astrolens kiosk <file>` assumes somebody is at a terminal. On the night they
 * usually aren't — the machine is plugged into a screen and whoever is running
 * the session wants to pick a file and have a frame appear. This serves that
 * one page, and nothing else: choose a file, optionally say what it is, go.
 *
 * Deliberately not the studio. No project list, no editing, no export menu —
 * everything here has to be usable at arm's length in the dark by someone who
 * is also answering questions.
 */

const ACCEPT = '.fits,.fit,.fts,.jpg,.jpeg,.png,.tif,.tiff';

export interface KioskServeArgs {
  port?: number;
  open?: boolean;
  workdir?: string;
}

function page(opts: {
  styles: string[];
  ready: boolean;
  missing: string[];
  hubUrl?: string;
}): string {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>astrolens · 现场</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{min-height:100vh;background:#05070c;color:#e6e9f0;display:flex;align-items:center;
  justify-content:center;padding:24px;
  font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
.card{width:min(560px,100%);background:#0b0f18;border:1px solid #1e2637;border-radius:16px;padding:30px;}
h1{font-size:24px;font-weight:700;}
.sub{margin-top:6px;color:#8a93a8;font-size:14px;line-height:1.6;}
label{display:block;margin-top:20px;font-size:13px;color:#8a93a8;}
input[type=text],select{width:100%;margin-top:7px;background:#141925;border:1px solid #2a3346;
  color:#e6e9f0;border-radius:10px;padding:12px 14px;font-size:16px;}
.file{margin-top:8px;display:block;border:1px dashed #2f3a52;border-radius:12px;padding:22px;
  text-align:center;color:#9aa4bb;cursor:pointer;font-size:15px;}
.file:hover{border-color:#3f4d6b;color:#cfd6e4;}
.file input{display:none;}
.row{display:flex;gap:12px;}
.row>*{flex:1 1 0;}
button.go{margin-top:24px;width:100%;background:#2b6cb0;border:0;color:#fff;border-radius:12px;
  padding:15px;font-size:17px;font-weight:600;cursor:pointer;}
button.go:disabled{background:#243447;color:#6b768f;cursor:default;}
.status{margin-top:16px;font-size:13px;line-height:1.6;color:#8a93a8;min-height:20px;}
.warn{color:#e0af68;}
.err{color:#f7768e;}
.back{display:inline-block;margin-bottom:14px;color:#8a93a8;text-decoration:none;font-size:13px;}
.back:hover{color:#cfd6e4;}
.foot{margin-top:22px;padding-top:16px;border-top:1px solid #1b2231;color:#5d6780;font-size:12px;line-height:1.6;}
</style>
</head>
<body>
<form class="card" id="f">
  ${opts.hubUrl ? `<a class="back" href="${opts.hubUrl}">← astrolens</a>` : ''}
  <h1>现场识别</h1>
  <p class="sub">选一张图,几秒后出一张可点的全屏页。支持 FITS(自动拉伸)、JPG、PNG、TIFF。</p>

  <label class="file">
    <input type="file" id="file" accept="${ACCEPT}">
    <span id="fname">点这里选择图片…</span>
  </label>

  <label>目标名(可选,填了识别更稳)
    <input type="text" id="target" placeholder="例如 M42 / NGC 3372 / Sh2-308">
  </label>

  <div class="row">
    <label>语言
      <select id="lang"><option value="zh">中文</option><option value="en">English</option></select>
    </label>
    ${
      opts.styles.length > 1
        ? `<label>讲解风格<select id="style">${opts.styles
            .map((s) => `<option>${s}</option>`)
            .join('')}</select></label>`
        : ''
    }
  </div>

  <button class="go" id="go" type="submit" disabled>开始</button>
  <p class="status" id="status"></p>

  <p class="foot">
    ${
      opts.ready
        ? ' · 离线星表齐全,可断网运行'
        : ` · <span class="warn">离线星表缺 ${opts.missing.join('、')},先跑 astrolens prefetch</span>`
    }
  </p>
</form>
<script>
var file=document.getElementById('file'), go=document.getElementById('go'),
    st=document.getElementById('status'), fname=document.getElementById('fname');
file.addEventListener('change',function(){
  var f=file.files[0];
  fname.textContent = f ? f.name : '点这里选择图片…';
  go.disabled = !f;
});
document.getElementById('f').addEventListener('submit', async function(e){
  e.preventDefault();
  var f=file.files[0]; if(!f) return;
  go.disabled=true;
  st.className='status';
  st.textContent='读取文件…';
  var b64=await new Promise(function(res,rej){
    var r=new FileReader(); r.onload=function(){res(r.result);}; r.onerror=rej; r.readAsDataURL(f);
  });
  st.textContent='解析中…(plate solve 可能要几十秒)';
  try{
    var r=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({filename:f.name, dataUrl:b64,
        target:document.getElementById('target').value.trim()||undefined,
        lang:document.getElementById('lang').value,
        style:(document.getElementById('style')||{}).value})});
    var j=await r.json();
    if(!j.ok) throw new Error(j.error||'识别失败');
    st.textContent='完成:'+j.objectName+' — 正在打开…';
    location.href=j.url;
  }catch(err){
    st.className='status err';
    st.textContent=String(err.message||err);
    go.disabled=false;
  }
});
</script>
</body>
</html>`;
}

export async function serveKiosk(args: KioskServeArgs = {}): Promise<void> {
  const port = args.port ?? 3200;
  const workdir = resolve(args.workdir ?? join(tmpdir(), 'astrolens-kiosk'));
  await mkdir(workdir, { recursive: true });
  const cfg = loadConfig();

  const app = express();
  app.use(express.json({ limit: '256mb' })); // a FITS master is not small

  app.get('/favicon.svg', (_req, res) => {
    res.type('image/svg+xml').set('cache-control', 'max-age=86400').send(KIOSK_FAVICON);
  });

  app.get('/', async (_req, res) => {
    const status = await offlineCatalogStatus().catch(() => []);
    res.type('html').send(
      page({
        styles: [cfg.reading.style],
        ready: status.length ? isOfflineReady(status) : true,
        missing: status.filter((s) => !s.present).map((s) => s.key),
        hubUrl: process.env.ASTROLENS_HUB_URL || undefined,
      }),
    );
  });

  let seq = 0;
  app.post('/api/run', async (req, res) => {
    try {
      const body = req.body as {
        filename?: string;
        dataUrl?: string;
        target?: string;
        lang?: string;
        style?: string;
      };
      if (!body.dataUrl) throw new Error('No file received');
      const ext = (extname(body.filename ?? '') || '.jpg').toLowerCase();
      const id = `f${++seq}`;
      const dir = join(workdir, id);
      await mkdir(dir, { recursive: true });
      const src = join(dir, `source${ext}`);
      await writeFile(src, Buffer.from(body.dataUrl.replace(/^data:[^;]+;base64,/, ''), 'base64'));

      // The browser already has the page open; opening another one on the
      // server would put the frame on the wrong screen.
      const result = await runKiosk({
        image: src,
        target: body.target,
        lang: body.lang,
        style: body.style,
        out: dir,
        open: false,
      });
      if (!result) throw new Error('这张图没有识别出可用的天体,没有生成页面。');
      res.json({ ok: true, url: `/view/${id}`, objectName: result.objectName, state: result.state });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  app.get('/view/:id', async (req, res) => {
    try {
      if (!/^f\d+$/.test(req.params.id)) throw new Error('bad id');
      res.type('html').send(await readFile(join(workdir, req.params.id, 'kiosk.html'), 'utf8'));
    } catch {
      res.status(404).type('text').send('Not found');
    }
  });

  await new Promise<void>((ok) => {
    const server = app.listen(port, () => ok());
    server.on('error', (e) => {
      throw e;
    });
  });
  const url = `http://localhost:${port}/`;
  console.log(`Kiosk front door: ${url}`);
  console.log(`Frames written to ${workdir}`);
  console.log('Ctrl+C to stop.');
  exitWhenOrphaned();
  if (args.open !== false) {
    const cmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    const { execFile } = await import('node:child_process');
    execFile(cmd, [url], () => {
      /* headless is fine */
    });
  }
  await new Promise<void>(() => {
    /* run until interrupted */
  });
}
