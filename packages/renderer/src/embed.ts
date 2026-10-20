import { COLOR_PALETTE, badgeAnchor, type Feature, type Reading } from '@astellum/schema';

function paragraphs(f: Feature, lang: 'zh' | 'en'): string[] {
  return [f.explanation[lang], f.physics?.[lang], f.interesting?.[lang]]
    .filter((s): s is string => !!s)
    .join('\n\n')
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface EmbedOptions {
  /** data: URI of the source image, so the output is a single portable file. */
  imageDataUri: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build a single self-contained, interactive embed.html for a report. */
export function generateEmbedHtml(report: Reading, opts: EmbedOptions): string {
  const { width, height } = report.image;
  const lang = report.display_language;
  const strokeW = Math.max(2, Math.round(Math.min(width, height) / 400));

  const overlay = report.features
    .map((f) => {
      const c = COLOR_PALETTE[f.color_key];
      const { cx, cy, r } = f.circle;
      const [ax, ay] = badgeAnchor(f, f.badge.bubble_r);
      const bx = ax + f.badge.offset_x;
      const by = ay + f.badge.offset_y;
      const fs = f.badge.bubble_r * 1.1;
      // A comet nucleus is a small filled dot; everything else a ring at circle.r.
      const mark =
        f.shape === 'dot'
          ? `<circle class="al-circle" cx="${cx}" cy="${cy}" r="${strokeW * 2.5}" fill="${c.stroke}" stroke="none"/>`
          : `<circle class="al-circle" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.stroke}" stroke-width="${strokeW}"/>`;
      return `<g class="al-feat" data-f="${esc(f.id)}">
  ${mark}
  <circle cx="${bx}" cy="${by}" r="${f.badge.bubble_r}" fill="${c.badge}" stroke="#0b0e14" stroke-width="${Math.max(1, strokeW / 2)}"/>
  <text x="${bx}" y="${by}" font-size="${fs}" font-weight="700" fill="#0b0e14" text-anchor="middle" dominant-baseline="central">${esc(f.badge.num)}</text>
</g>`;
    })
    .join('\n');

  const tips = report.features
    .map((f) => {
      const left = ((f.circle.cx / width) * 100).toFixed(2);
      const top = ((f.circle.cy / height) * 100).toFixed(2);
      const body = paragraphs(f, lang).map((p) => `<p>${esc(p)}</p>`).join('');
      return `<div class="al-tip" data-f="${esc(f.id)}" style="left:${left}%;top:${top}%">
  <b>${esc(f.badge.num)}. ${esc(f.label[lang])}</b>${body}
</div>`;
    })
    .join('\n');

  const panel = report.features
    .map((f) => {
      const c = COLOR_PALETTE[f.color_key];
      const body = paragraphs(f, lang).map((p) => `<p>${esc(p)}</p>`).join('');
      return `<div class="al-feature" data-f="${esc(f.id)}">
  <span class="al-dot" style="background:${c.badge}">${esc(f.badge.num)}</span>
  <div><b>${esc(f.label[lang])}</b>${body}</div>
</div>`;
    })
    .join('\n');

  const o = report.object;

  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.name[lang])} — ASTELLUM</title>
<style>
.al-embed{--al-bg:#0b0e14;--al-panel:#141925;--al-text:#e6e9f0;--al-muted:#8a93a8;
  background:var(--al-bg);color:var(--al-text);border-radius:10px;overflow:hidden;
  font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  display:flex;flex-wrap:wrap;max-width:100%;}
.al-embed *{box-sizing:border-box;}
.al-stage{position:relative;flex:1 1 420px;min-width:0;line-height:0;}
.al-stage img{width:100%;display:block;}
.al-svg{position:absolute;inset:0;width:100%;height:100%;}
.al-feat{cursor:pointer;}
.al-feat .al-circle{opacity:.7;transition:opacity .15s,stroke-width .15s;}
.al-feat:hover .al-circle,.al-feat.active .al-circle{opacity:1;}
.al-tip{position:absolute;transform:translate(-50%,-115%);background:rgba(11,14,20,.95);
  border:1px solid #2a3346;border-radius:8px;padding:10px 12px;width:240px;max-width:70vw;
  font-size:13px;line-height:1.6;display:none;z-index:5;pointer-events:none;}
.al-tip.show{display:block;}
.al-tip b{display:block;margin-bottom:4px;}
.al-tip p{margin:6px 0 0;color:#aeb6c6;}
.al-panel{flex:1 1 280px;padding:18px;max-height:560px;overflow-y:auto;background:var(--al-panel);}
.al-panel h3{margin:0;font-size:18px;}
.al-panel .al-meta{color:var(--al-muted);font-size:12px;margin:4px 0 12px;}
.al-narr{font-size:13px;line-height:1.7;color:#cfd6e4;margin:0 0 16px;}
.al-feature{display:flex;gap:10px;padding:8px;border-radius:8px;cursor:pointer;}
.al-feature:hover,.al-feature.active{background:#1c2333;}
.al-dot{flex-shrink:0;width:24px;height:24px;border-radius:50%;color:#0b0e14;font-weight:700;
  font-size:12px;display:flex;align-items:center;justify-content:center;}
.al-feature b{font-size:14px;}
.al-feature p{margin:3px 0 0;font-size:12.5px;line-height:1.6;color:#aeb6c6;}
</style>
</head>
<body style="margin:0;background:#0b0e14;">
<div class="al-embed">
  <div class="al-stage">
    <img src="${opts.imageDataUri}" alt="${esc(o.name[lang])}">
    <svg class="al-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
${overlay}
    </svg>
${tips}
  </div>
  <div class="al-panel">
    <h3>${esc(o.name[lang])}</h3>
    <p class="al-narr">${esc(report.narrative[lang])}</p>
${panel}
  </div>
</div>
<script>
(function(){
  var root=document.currentScript.previousElementSibling;
  var active=null;
  function set(id){
    active=id;
    root.querySelectorAll('.al-feat,.al-feature').forEach(function(el){
      el.classList.toggle('active',el.getAttribute('data-f')===id);
    });
    root.querySelectorAll('.al-tip').forEach(function(el){
      el.classList.toggle('show',el.getAttribute('data-f')===id);
    });
    if(id){
      var item=root.querySelector('.al-feature[data-f="'+id+'"]');
      if(item) item.scrollIntoView({block:'nearest',behavior:'smooth'});
    }
  }
  root.querySelectorAll('.al-feat').forEach(function(g){
    var id=g.getAttribute('data-f');
    g.addEventListener('mouseenter',function(){set(id);});
    g.addEventListener('click',function(e){e.stopPropagation();set(active===id?null:id);});
  });
  root.querySelectorAll('.al-feature').forEach(function(it){
    it.addEventListener('click',function(){set(it.getAttribute('data-f'));});
  });
  root.querySelector('.al-stage').addEventListener('click',function(e){
    if(e.target.tagName==='IMG') set(null);
  });
})();
</script>
</body>
</html>`;
}
