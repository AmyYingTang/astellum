import type * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { LocalizedString, PredefinedReading } from '@astrolens/schema';

/**
 * The predefined reading for the target currently open in the atlas.
 *
 * It lives here because reviewing text and reviewing annotations are the same
 * pass over the same target — and because the per-annotation lines only make
 * sense next to the shapes they describe. Each approved annotation gets its own
 * slot rather than one free-text field, so it is obvious what is still unwritten.
 *
 * Which file this writes is decided by which atlas you opened: the shipped seed
 * for a curator, your own data dir for a deployment correcting it. A deployment
 * therefore edits its own layer, and pulling a new release never overwrites its
 * wording — the two are merged at read time, field by field.
 */

interface AnnotationSlot {
  id: string;
  feature_type: string;
  label: LocalizedString;
  note: LocalizedString | null;
}

interface Loaded {
  reading: PredefinedReading | null;
  annotations: AnnotationSlot[];
}

const EMPTY: LocalizedString = { zh: '', en: '' };
const has = (s?: LocalizedString | null): boolean => !!s && (!!s.zh.trim() || !!s.en.trim());

function Pair({
  label,
  hint,
  value,
  rows = 3,
  onChange,
}: {
  label: string;
  hint?: string;
  value: LocalizedString;
  rows?: number;
  onChange: (v: LocalizedString) => void;
}): React.JSX.Element {
  return (
    <div className="rd-field">
      <label className="rd-label">
        {label}
        {hint && <span className="rd-hint">{hint}</span>}
      </label>
      <textarea
        rows={rows}
        placeholder="中文"
        value={value.zh}
        onChange={(e) => onChange({ ...value, zh: e.target.value })}
      />
      <textarea
        rows={rows}
        placeholder="English"
        value={value.en}
        onChange={(e) => onChange({ ...value, en: e.target.value })}
      />
    </div>
  );
}

export function ReadingEditor({
  primaryId,
  aliases,
  style = 'general',
}: {
  primaryId: string;
  aliases: string[];
  style?: string;
}): React.JSX.Element | null {
  const [data, setData] = useState<Loaded | null>(null);
  const [narrative, setNarrative] = useState<LocalizedString>(EMPTY);
  const [scale, setScale] = useState<LocalizedString>(EMPTY);
  const [culture, setCulture] = useState<LocalizedString>(EMPTY);
  const [funFact, setFunFact] = useState<LocalizedString>(EMPTY);
  const [features, setFeatures] = useState<Record<string, LocalizedString>>({});
  const [source, setSource] = useState<PredefinedReading['source']>('human');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!primaryId.trim()) return;
    const r = await fetch(`/api/readings/${encodeURIComponent(primaryId.trim())}`);
    const j = (await r.json()) as Loaded & { ok: boolean };
    setData({ reading: j.reading, annotations: j.annotations ?? [] });
    const s = j.reading?.styles?.[style];
    setNarrative(s?.narrative ?? EMPTY);
    setScale(s?.scale ?? EMPTY);
    setCulture(s?.culture ?? EMPTY);
    setFunFact(s?.fun_facts?.[0] ?? EMPTY);
    setSource(j.reading?.source ?? 'human');
    setFeatures(
      Object.fromEntries((s?.features ?? []).map((f) => [f.annotation_id, f.explanation])),
    );
  }, [primaryId, style]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!primaryId.trim()) return null;

  const save = async (): Promise<void> => {
    setStatus('保存中…');
    const reading: PredefinedReading = {
      schema_version: 1,
      primary_id: primaryId.trim(),
      aliases,
      source,
      styles: {
        [style]: {
          ...(has(narrative) ? { narrative } : {}),
          ...(has(scale) ? { scale } : {}),
          ...(has(culture) ? { culture } : {}),
          fun_facts: has(funFact) ? [funFact] : [],
          features: Object.entries(features)
            .filter(([, v]) => has(v))
            .map(([annotation_id, explanation]) => ({ annotation_id, explanation })),
        },
      },
    };
    const r = await fetch(`/api/readings/${encodeURIComponent(primaryId.trim())}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reading }),
    });
    const j = (await r.json()) as { ok: boolean; error?: string };
    setStatus(j.ok ? '已保存' : (j.error ?? '保存失败'));
    if (j.ok) void load();
  };

  const missing: string[] = [];
  if (!has(narrative)) missing.push('导读');
  if (!has(scale)) missing.push('尺度感');
  if (!has(culture)) missing.push('文化');
  if (!has(funFact)) missing.push('冷知识');
  const unwritten = (data?.annotations ?? []).filter((a) => !has(features[a.id])).length;
  if (unwritten) missing.push(`${unwritten} 条特征`);

  return (
    <section className="rd">
      <button className="wide-ghost" onClick={() => setOpen((v) => !v)}>
        {open ? '收起解读' : '编辑现场解读'}
        {!open && data?.reading && <span className="rd-tag">已录</span>}
      </button>

      {open && (
        <>
          <p className="hint">
            现场没有网络和 AI 时显示的文字。留空的项会退回到通用说明或事实模板 —— 不会空白。
          </p>

          {data?.reading?.source === 'ai_draft' && (
            <p className="banner banner-edit">
              这是 AI 草稿,还没人审过。改完把状态设成「已审核」。
            </p>
          )}

          <Pair
            label="导读"
            hint="这是什么、在哪个星座"
            value={narrative}
            rows={4}
            onChange={setNarrative}
          />
          <Pair label="尺度感" hint="在银河系之内还是之外、多远、多大" value={scale} onChange={setScale} />
          <Pair label="文化" hint="命名来源、神话、观测史" value={culture} onChange={setCulture} />
          <Pair label="冷知识" value={funFact} onChange={setFunFact} />

          <div className="rd-features">
            <h4>逐条特征</h4>
            {(data?.annotations ?? []).length === 0 && (
              <p className="hint">这个目标还没有已批准的标注 —— 先审核标注,这里才会出现槽位。</p>
            )}
            {(data?.annotations ?? []).map((a) => (
              <Pair
                key={a.id}
                label={a.label.zh || a.label.en || a.feature_type}
                hint={a.note?.zh || a.note?.en || undefined}
                value={features[a.id] ?? EMPTY}
                rows={2}
                onChange={(v) => setFeatures((prev) => ({ ...prev, [a.id]: v }))}
              />
            ))}
          </div>

          <div className="rd-foot">
            <label className="rd-source">
              状态
              <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="human">已审核</option>
                <option value="ai_draft">AI 草稿</option>
                <option value="ai_approved">AI 生成,已认可</option>
              </select>
            </label>
            <button className="primary" onClick={() => void save()}>
              保存解读
            </button>
          </div>
          {missing.length > 0 && <p className="hint">还缺:{missing.join('、')}</p>}
          {status && <p className="status">{status}</p>}
        </>
      )}
    </section>
  );
}
