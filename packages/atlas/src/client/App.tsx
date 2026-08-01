import { useEffect, useMemo, useRef, useState } from 'react';
import { worldToPixel, pixelToWorld, type Wcs } from '@astrolens/schema';
import { Canvas, type Shape } from './Canvas.js';
import { useLang } from './i18n.js';
import {
  fetchFeatureTypes,
  fetchConfig,
  uploadImage,
  pollJob,
  fetchTargets,
  getObject,
  saveObject,
  exportRegistry,
} from './api.js';
import type { FeatureType, Geometry } from '../featureTypes.js';
import type { Annotation, AnnoStatus, AtlasEntry } from '../atlas.js';
import type { TargetRow } from '../shared.js';

type Kind = 'new' | 'canonical' | 'other';

interface Session {
  imageSrc: string;
  imageRef: string;
  wcs: Wcs;
  width: number;
  height: number;
  /** Object type from the identify pipeline (context only, not stored). */
  typeContext?: string;
  /** Whether identity was auto-detected. */
  identityNote?: string;
  /** Attribution, for reference images sourced from Commons/ESO/NASA rather
   *  than shot by the annotator. Carried through save so it isn't dropped. */
  credit?: string;
  license?: string;
  sourceUrl?: string;
}

function StepHead({ n, title }: { n: number; title: string }): JSX.Element {
  return (
    <h3 className="step">
      <span className="step-n">{n}</span>
      {title}
    </h3>
  );
}

/** A small `?` badge that reveals `text` on hover (instant, unlike native title).
 *  align='right' opens the tip leftward so icons near the panel edge don't clip. */
function HelpIcon({ text, align = 'left' }: { text: string; align?: 'left' | 'right' }): JSX.Element {
  return (
    <span className="help">
      <span className="help-icon">?</span>
      <span className={align === 'right' ? 'help-tip right' : 'help-tip'}>{text}</span>
    </span>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new window.Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('无法解码图像 · Could not decode image (JPG/PNG only — FITS/XISF not supported yet)'));
    im.src = src;
  });
}

// The reference image only needs to display + plate-solve, so downscale big
// astrophotos in the browser before upload: keeps the payload well under the
// body limit, speeds up the solve, and the WCS we get back matches the pixels
// we send. Longest edge capped; JPEG re-encode. Small JPEGs pass through as-is.
async function prepareUpload(file: File, maxEdge = 4096): Promise<{ dataUrl: string; filename: string }> {
  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, maxEdge / longest);
  if (scale === 1 && /\.jpe?g$/i.test(file.name)) {
    return { dataUrl: original, filename: file.name };
  }
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const stem = file.name.replace(/\.[^.]+$/, '') || 'reference';
  return { dataUrl, filename: `${stem}.jpg` };
}

export function App(): JSX.Element {
  const { t, lang, setLang } = useLang();
  const [types, setTypes] = useState<FeatureType[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const [primaryId, setPrimaryId] = useState('');
  const [aliasesText, setAliasesText] = useState('');
  const [typeKey, setTypeKey] = useState('pillar');
  const [drawing, setDrawing] = useState(false);
  const [draftPx, setDraftPx] = useState<[number, number][]>([]);
  // Which committed annotation is open for geometry editing (drag vertices /
  // whole shape). Only honoured in edit mode when not drawing.
  const [editShapeId, setEditShapeId] = useState<string | null>(null);
  // In the existing-entry flow the draw controls start collapsed — reviewing is
  // the common case there, adding another feature is the exception.
  const [addOpen, setAddOpen] = useState(false);
  // Identity fields are collapsed to a summary line for an existing entry.
  const [idOpen, setIdOpen] = useState(false);
  // The left panel is the only entry point: nothing on the right is actionable
  // until a target is picked here (or "add a new target" is chosen). `target`
  // holds the picked row so an image-less target can still be set up.
  const [sel, setSel] = useState<{ mode: 'none' } | { mode: 'newTarget' } | { mode: 'target'; row: TargetRow }>(
    { mode: 'none' },
  );
  const [labelZh, setLabelZh] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'none' | 'noimg' | 'draft' | 'review' | 'approved'>('all');
  const [saveMsg, setSaveMsg] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [solverInfo, setSolverInfo] = useState<{ solver: string; localSolver: boolean; hubUrl?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewFileRef = useRef<HTMLInputElement>(null);

  // Who is acting — sets author on new annotations, reviewed_by on approve.
  const [currentUser, setCurrentUser] = useState<string>(() => {
    try {
      return localStorage.getItem('atlas_user') || 'amy';
    } catch {
      return 'amy';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('atlas_user', currentUser);
    } catch {
      // ignore
    }
  }, [currentUser]);

  // Edit context: `editable` gates drawing/status/save; `kind` picks the banner
  // and which preview actions apply. `loadedId` = the library entry in context.
  const [editable, setEditable] = useState(true);
  const [kind, setKind] = useState<Kind>('new');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  // Revision of the loaded entry, for optimistic-concurrency on save.
  const [entryRev, setEntryRev] = useState(0);

  const curType = useMemo(() => types.find((x) => x.key === typeKey), [types, typeKey]);
  const geometry: Geometry = curType?.geometry ?? 'polygon';

  // Display name for an annotation: its proper label, else the localized type
  // name (not the raw key), matching the consumer-side fallback.
  const typeName = (key: string): string => {
    const ft = types.find((x) => x.key === key);
    return ft ? ft[lang] : key;
  };

  // Per-annotation display name with auto-numbering: unnamed features of the
  // same type get an ordinal ("Pillar 1", "Pillar 2") so multiple of one type
  // are distinguishable. Named ones use their name. Numbering is display-only —
  // it is NOT stored (the atlas keeps the ordered array); the apply side should
  // mirror this convention.
  const displayNames = useMemo(() => {
    const map = new Map<string, string>();
    const unnamedByType = new Map<string, string[]>();
    for (const a of annotations) {
      if (!a.label[lang]?.trim()) {
        const arr = unnamedByType.get(a.feature_type) ?? [];
        arr.push(a.id);
        unnamedByType.set(a.feature_type, arr);
      }
    }
    for (const a of annotations) {
      const named = a.label[lang]?.trim();
      if (named) {
        map.set(a.id, named);
        continue;
      }
      const arr = unnamedByType.get(a.feature_type) ?? [];
      const tn = typeName(a.feature_type);
      map.set(a.id, arr.length > 1 ? `${tn} ${arr.indexOf(a.id) + 1}` : tn);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, types, lang]);

  useEffect(() => {
    void fetchFeatureTypes().then((f) => {
      setTypes(f);
      const first = f.find((x) => x.defaultOn) ?? f[0];
      if (first) setTypeKey(first.key);
    });
    void fetchConfig().then(setSolverInfo).catch(() => setSolverInfo(null));
    void refreshTargets();
  }, []);

  const refreshTargets = async (): Promise<void> => {
    const { targets } = await fetchTargets();
    setTargets(targets);
  };

  const onPickFile = async (file: File, opts?: { preview?: boolean }): Promise<void> => {
    const preview = opts?.preview ?? false;
    setBusy(true);
    setEditShapeId(null);
    setStatus(t('storing'));
    try {
      const { dataUrl, filename } = await prepareUpload(file);
      const up = await uploadImage({ filename, imageBase64: dataUrl });
      if (!up.ok || !up.jobId) throw new Error(up.error ?? 'upload failed');
      const job = await pollJob(up.jobId, (j) =>
        setStatus(j.stage === 'identifying' ? t('identifying') : j.stage === 'solving' ? t('solving') : t('storing')),
      );
      if (job.state !== 'done' || !job.wcs || !job.imageRef) {
        setStatus(`${t('solveFailed')}: ${job.error ?? ''}`);
        return;
      }
      if (preview) {
        // Mode B — verify the loaded entry's annotations on a different image of
        // the same target. Keep annotations + identity; only swap the base image
        // + WCS (the shapes memo reprojects via session.wcs). Read-only.
        setSession({
          imageSrc: `/refimg/${job.imageRef}`,
          imageRef: job.imageRef,
          wcs: job.wcs,
          width: job.width ?? job.wcs.width,
          height: job.height ?? job.wcs.height,
        });
        setEditable(false);
        setKind('other');
        setStatus(t('solved'));
        return;
      }
      const sug = job.suggested;
      const typeContext = sug?.type
        ? [sug.type.zh, sug.type.en].filter(Boolean).join(' / ') + ` (${sug.type.otype})`
        : undefined;
      setSession({
        imageSrc: `/refimg/${job.imageRef}`,
        imageRef: job.imageRef,
        wcs: job.wcs,
        width: job.width ?? job.wcs.width,
        height: job.height ?? job.wcs.height,
        typeContext,
        identityNote: sug ? t('autoFilled') : t('noIdentify'),
      });
      if (sug) {
        setPrimaryId(sug.primary_id);
        setAliasesText(sug.aliases.join(', '));
      }
      setAnnotations([]);
      setEntryRev(0);
      setEditable(true);
      setKind('new');
      setLoadedId(null);
      setStatus(t('solved'));
    } catch (e) {
      setStatus(`${t('solveFailed')}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onAddPoint = (x: number, y: number): void => {
    if (geometry === 'point') {
      setDraftPx([[x, y]]);
    } else {
      setDraftPx((d) => [...d, [x, y]]);
    }
  };

  const finishShape = (): void => {
    if (!session) return;
    const minPts = geometry === 'point' ? 1 : geometry === 'polygon' ? 3 : 2;
    if (draftPx.length < minPts) return;
    // px → ICRS via the reference image's WCS.
    const verts: [number, number][] = [];
    for (const [x, y] of draftPx) {
      const sky = pixelToWorld(session.wcs, x, y);
      verts.push([sky[0], sky[1]]);
    }
    const now = new Date().toISOString();
    const anno: Annotation = {
      id: `anno_${Date.now().toString(36)}`,
      feature_type: typeKey,
      geometry: { type: geometry, vertices: verts },
      label: { zh: labelZh, en: labelEn },
      status: 'draft',
      author: currentUser,
      created_at: now,
      updated_at: now,
    };
    setAnnotations((a) => [...a, anno]);
    setDraftPx([]);
    setLabelZh('');
    setLabelEn('');
  };

  const minPts = geometry === 'point' ? 1 : geometry === 'polygon' ? 3 : 2;
  const canFinish = drawing && draftPx.length >= minPts;
  const startDraw = (): void => {
    setDraftPx([]);
    setDrawing(true);
    setEditShapeId(null);
  };
  const endDraw = (): void => {
    setDraftPx([]);
    setDrawing(false);
  };
  const finishSave = (): void => {
    finishShape(); // commits if enough points; clears the draft + name inputs
    setDrawing(false);
  };

  const setAnnoStatus = (id: string, status: AnnoStatus): void => {
    const now = new Date().toISOString();
    setAnnotations((xs) =>
      xs.map((a) =>
        a.id === id
          ? { ...a, status, reviewed_by: status === 'approved' ? currentUser : a.reviewed_by, updated_at: now }
          : a,
      ),
    );
  };

  // Commit a geometry edit from the canvas: new vertices arrive in image px,
  // convert back to ICRS via the current image's WCS (same transform the draw
  // path uses). Metadata (id, author, status, created_at) is preserved — the
  // whole point of editing in place rather than delete + redraw.
  const onEditShape = (id: string, verticesPx: [number, number][]): void => {
    if (!session) return;
    const now = new Date().toISOString();
    setAnnotations((xs) =>
      xs.map((a) => {
        if (a.id !== id) return a;
        const vertices = verticesPx.map(([x, y]) => {
          const s = pixelToWorld(session.wcs, x, y);
          return [s[0], s[1]] as [number, number];
        });
        return { ...a, geometry: { ...a.geometry, vertices }, updated_at: now };
      }),
    );
  };

  // Move a feature's name label. Stored as an ICRS anchor like the geometry, so
  // the placement survives reprojection onto any other image (and is carried
  // into the exported registry → apply output).
  const onMoveLabel = (id: string, labelPx: [number, number]): void => {
    if (!session) return;
    const sky = pixelToWorld(session.wcs, labelPx[0], labelPx[1]);
    const now = new Date().toISOString();
    setAnnotations((xs) =>
      xs.map((a) =>
        a.id === id ? { ...a, label_anchor: [sky[0], sky[1]] as [number, number], updated_at: now } : a,
      ),
    );
  };

  // Rename a feature in place — keeps id / author / status / created_at, unlike
  // delete + redraw.
  const onRename = (id: string, which: 'zh' | 'en', value: string): void => {
    const now = new Date().toISOString();
    setAnnotations((xs) =>
      xs.map((a) => (a.id === id ? { ...a, label: { ...a.label, [which]: value }, updated_at: now } : a)),
    );
  };

  const doExport = async (): Promise<void> => {
    const r = await exportRegistry();
    setExportMsg(r.ok ? `${t('exported')}: ${r.objects} · ${r.annotations}` : `⚠ ${r.error ?? ''}`);
    setTimeout(() => setExportMsg(''), 4000);
  };

  const exitCheck = (): void => {
    if (loadedId) void loadEntry(loadedId);
  };

  /** Reset the working state so a fresh selection can't inherit the last one. */
  const clearWorkspace = (): void => {
    setSession(null);
    setAnnotations([]);
    setEditShapeId(null);
    setDrawing(false);
    setDraftPx([]);
    setAddOpen(false);
    setIdOpen(false);
    setEntryRev(0);
    setLoadedId(null);
    setStatus('');
    setSaveMsg('');
  };

  /** Start a brand-new target: a blank identity the curator fills in. */
  const startNewTarget = (): void => {
    clearWorkspace();
    setPrimaryId('');
    setAliasesText('');
    setEditable(true);
    setKind('new');
    setSel({ mode: 'newTarget' });
  };

  /** Pick a target from the list. One with an entry loads it; one without (no
   *  reference image yet) still opens — prefilled from the seed row — so it can
   *  be set up by uploading an image. */
  const selectTarget = (row: TargetRow): void => {
    setSel({ mode: 'target', row });
    if (row.primary_id) {
      void loadEntry(row.primary_id);
      return;
    }
    clearWorkspace();
    setPrimaryId(row.designation);
    setAliasesText(row.match.filter((m) => m !== row.designation).join(', '));
    setEditable(true);
    setKind('new'); // no entry yet → it behaves like a new one, minus the identity guesswork
  };

  const loadEntry = async (id: string): Promise<void> => {
    const { entry } = await getObject(id);
    if (!entry) return;
    setEditShapeId(null);
    setAddOpen(false);
    setIdOpen(false);
    setPrimaryId(entry.primary_id);
    setAliasesText(entry.aliases.join(', '));
    setAnnotations(entry.annotations);
    setEntryRev(entry.rev ?? 0);
    setLoadedId(entry.primary_id);
    setEditable(false);
    setKind('canonical');
    setDrawing(false);
    if (entry.reference) {
      setSession({
        imageSrc: `/refimg/${entry.reference.image_ref}`,
        imageRef: entry.reference.image_ref,
        wcs: entry.reference.wcs,
        width: entry.reference.width_px,
        height: entry.reference.height_px,
        credit: entry.reference.credit,
        license: entry.reference.license,
        sourceUrl: entry.reference.source_url,
      });
      setStatus(t('solved'));
    }
  };

  const save = async (): Promise<void> => {
    if (!session || !primaryId.trim()) return;
    const entry: AtlasEntry = {
      primary_id: primaryId.trim(),
      aliases: aliasesText.split(',').map((s) => s.trim()).filter(Boolean),
      reference: {
        image_ref: session.imageRef,
        wcs: session.wcs,
        width_px: session.width,
        height_px: session.height,
        credit: session.credit,
        license: session.license,
        source_url: session.sourceUrl,
      },
      annotations,
      // The rev we loaded — the server rejects the save if it moved on, so we
      // can't silently clobber the other editor's work.
      rev: entryRev,
    };
    const r = await saveObject(entry.primary_id, { entry });
    if (r.conflict) {
      // Stale page: keep their edits on screen but make it clear a reload is needed.
      setSaveMsg(`⚠ ${t('saveConflict')}`);
      return; // no auto-clear — this one must be read
    }
    setSaveMsg(r.ok ? t('saved') : `⚠ ${r.error ?? ''}`);
    if (r.ok) {
      setEntryRev(r.rev ?? entryRev + 1);
      void refreshTargets();
    }
    setTimeout(() => setSaveMsg(''), 2500);
  };

  // Render saved annotations onto the current image (sky → px).
  const shapes: Shape[] = useMemo(() => {
    if (!session) return [];
    const out: Shape[] = [];
    for (const a of annotations) {
      const px: [number, number][] = [];
      for (const [ra, dec] of a.geometry.vertices) {
        const p = worldToPixel(session.wcs, ra, dec);
        if (p) px.push([p[0], p[1]]);
      }
      if (px.length === 0) continue;
      let labelPx: [number, number] | undefined;
      if (a.label_anchor) {
        const lp = worldToPixel(session.wcs, a.label_anchor[0], a.label_anchor[1]);
        if (lp) labelPx = [lp[0], lp[1]];
      }
      out.push({
        id: a.id,
        type: a.geometry.type,
        verticesPx: px,
        color: types.find((x) => x.key === a.feature_type)?.hint ?? '#7aa2f7',
        closed: a.geometry.type === 'polygon',
        label: displayNames.get(a.id) ?? '',
        ...(labelPx ? { labelPx } : {}),
      });
    }
    return out;
  }, [annotations, session, types, displayNames]);

  const draft = session
    ? { verticesPx: draftPx, type: geometry, color: curType?.hint ?? '#7aa2f7' }
    : null;

  // Target list = seed pool ⟕ real entries, narrowed by search + status filter.
  const visibleTargets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return targets.filter((x) => {
      if (filter === 'none' && x.annotations !== 0) return false;
      if (filter === 'noimg' && x.has_image) return false;
      if (filter === 'draft' && x.status.draft === 0) return false;
      if (filter === 'review' && x.status.in_review === 0) return false;
      if (filter === 'approved' && x.status.approved === 0) return false;
      if (!q) return true;
      return [x.designation, x.name_en, x.name_zh, x.kind_en, x.kind_zh, x.primary_id ?? '', ...x.match]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [targets, query, filter]);

  const statusLabel = (s: AnnoStatus): string =>
    s === 'approved' ? t('stApproved') : s === 'in_review' ? t('stReview') : t('stDraft');

  const annoList = (canEdit: boolean): JSX.Element => (
    <ul className="annos">
      {annotations.length === 0 && <li className="muted-li">{t('annotations')} (0)</li>}
      {annotations.map((a) => (
        <li key={a.id}>
          <span className="dot" style={{ background: types.find((x) => x.key === a.feature_type)?.hint }} />
          <span className="anno-name">{displayNames.get(a.id) ?? typeName(a.feature_type)}</span>
          {canEdit && (
            <button
              className={editShapeId === a.id ? 'adjust-btn active' : 'adjust-btn'}
              onClick={() => setEditShapeId((cur) => (cur === a.id ? null : a.id))}
            >
              {editShapeId === a.id ? t('adjustDone') : t('adjust')}
            </button>
          )}
          {canEdit ? (
            <select
              className={`st st-${a.status}`}
              value={a.status}
              onChange={(e) => setAnnoStatus(a.id, e.target.value as AnnoStatus)}
            >
              <option value="draft">{t('stDraft')}</option>
              <option value="in_review">{t('stReview')}</option>
              <option value="approved">{t('stApproved')}</option>
            </select>
          ) : (
            <span className={`st st-${a.status}`}>{statusLabel(a.status)}</span>
          )}
          {/* Renaming lives inside the adjust panel: same in-place-edit idea as
              the geometry, so id / author / status / created_at all survive. */}
          {canEdit && editShapeId === a.id && (
            <div className="anno-edit">
              <input
                placeholder={t('labelZh')}
                value={a.label.zh}
                onChange={(e) => onRename(a.id, 'zh', e.target.value)}
              />
              <input
                placeholder={t('labelEn')}
                value={a.label.en}
                onChange={(e) => onRename(a.id, 'en', e.target.value)}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  // The draw controls, shared by both flows: a numbered step in the new-image
  // wizard, a collapsible extra in the existing-entry flow.
  const drawControls = (
    <>
      <p className="hint substeps">{t('drawSteps')}</p>
      <label className="field-label">{t('featureType')}</label>
      <select value={typeKey} disabled={drawing} onChange={(e) => setTypeKey(e.target.value)}>
        {types.map((ft) => (
          <option key={ft.key} value={ft.key}>
            {ft.zh} · {ft.en} ({ft.geometry})
          </option>
        ))}
      </select>
      <label className="field-label">
        {t('labelName')}
        <HelpIcon text={t('labelHelp')} />
      </label>
      <input placeholder={t('labelZh')} value={labelZh} onChange={(e) => setLabelZh(e.target.value)} />
      <input placeholder={t('labelEn')} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
      {drawing ? (
        <>
          <p className="status">{t('pointsPlaced').replace('{n}', String(draftPx.length))}</p>
          <div className="row">
            <button className="primary" disabled={!canFinish} onClick={finishSave}>
              {t('finishSave')}
            </button>
            <button onClick={endDraw}>{t('endDraw')}</button>
          </div>
        </>
      ) : (
        <div className="btn-help-row">
          <button className="primary" onClick={startDraw}>
            {t('startDraw')}
          </button>
          <HelpIcon align="right" text={`${t('navHint')}\n${t('listHint')}`} />
        </div>
      )}
    </>
  );

  const saveBlock = (n: number): JSX.Element => (
    <section>
      <StepHead n={n} title={t('stepSave')} />
      <button className="primary" disabled={!primaryId.trim()} onClick={save}>
        {t('save')} ({annotations.length})
      </button>
      {!primaryId.trim() && <p className="hint">⚠ {t('needId')}</p>}
      {saveMsg && <p className="status">{saveMsg}</p>}
    </section>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <span className="brand">{t('title')}</span>
          <span className="sub">{t('subtitle')}</span>
        </div>
        <div className="topbar-right">
          {solverInfo?.hubUrl && (
            <a className="hub-link" href={solverInfo.hubUrl}>
              ← astrolens
            </a>
          )}
          {solverInfo && (
            <span className={solverInfo.localSolver ? 'solver-badge local' : 'solver-badge'}>
              {t('solverLabel')}: {solverInfo.solver}
            </span>
          )}
          <label className="user-field">
            {t('currentUser')}:
            <input value={currentUser} onChange={(e) => setCurrentUser(e.target.value)} />
          </label>
          <button className="lang" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </header>

      <div className="body">
        {/* Left — the only entry point: pick a target (top), export (bottom). */}
        <aside className="panel targets-panel">
          <section className="library">
            <h3>
              {t('targetsTitle')} ·{' '}
              {t('targetsDone')
                .replace('{a}', String(targets.filter((x) => x.annotations > 0).length))
                .replace('{b}', String(targets.length))}
            </h3>
            <button
              className={sel.mode === 'newTarget' ? 'wide-ghost add-target on' : 'wide-ghost add-target'}
              onClick={startNewTarget}
            >
              {t('addTarget')}
            </button>
            <input
              className="target-search"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="filters">
              {(['all', 'none', 'noimg', 'draft', 'review', 'approved'] as const).map((f) => (
                <button
                  key={f}
                  className={filter === f ? 'chip active' : 'chip'}
                  onClick={() => setFilter(f)}
                >
                  {t(
                    f === 'all'
                      ? 'fAll'
                      : f === 'none'
                        ? 'fNone'
                        : f === 'noimg'
                          ? 'fNoImage'
                          : f === 'draft'
                            ? 'fDraft'
                            : f === 'review'
                              ? 'fReview'
                              : 'fApproved',
                  )}
                </button>
              ))}
            </div>
            <ul className="targets">
              {visibleTargets.length === 0 && <li className="muted-li">{t('noMatch')}</li>}
              {visibleTargets.map((x) => {
                const done = x.status.approved > 0 && x.status.approved === x.annotations;
                return (
                  <li
                    key={x.key}
                    className={
                      (x.annotations === 0 ? 'target none' : done ? 'target done' : 'target') +
                      (sel.mode === 'target' && sel.row.key === x.key ? ' picked' : '')
                    }
                    title={`${lang === 'zh' ? x.kind_zh : x.kind_en}\n${lang === 'zh' ? x.note_zh : x.note_en}${
                      x.features.length ? `\n${t('suggested')}: ${x.features.join(', ')}` : ''
                    }`}
                  >
                    <span className="target-desig">{x.designation}</span>
                    {/* Every row is selectable — one without a reference image
                        opens too, so it can be set up by uploading one. */}
                    <button className="link" onClick={() => selectTarget(x)}>
                      {lang === 'zh' ? x.name_zh : x.name_en}
                    </button>
                    {/* An imported target has an image but no annotations yet,
                        so "ready to draw on" needs its own marker. */}
                    <span className={x.has_image ? 'img-dot on' : 'img-dot'} title={t('hasImage')}>
                      ▣
                    </span>
                    <span className="target-counts">
                      {x.annotations === 0 ? (
                        '0'
                      ) : (
                        <>
                          {x.status.approved > 0 && <b className="ok">{x.status.approved}✓</b>}
                          {x.status.in_review > 0 && <b className="rev">{x.status.in_review}⏳</b>}
                          {x.status.draft > 0 && <b className="dft">{x.status.draft}</b>}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Export is the end of the whole workflow — bottom, out of the way. */}
          <section className="export">
            <button onClick={doExport}>{t('exportRegistry')}</button>
            {exportMsg && <p className="status">{exportMsg}</p>}
          </section>
        </aside>

        {/* Centre — the image */}
        <main className="stage-area">
          {session ? (
            <Canvas
              imageSrc={session.imageSrc}
              imgWidth={session.width}
              imgHeight={session.height}
              drawing={drawing}
              allowDelete={editable && !drawing}
              shapes={shapes}
              draft={draft}
              editShapeId={editable && !drawing ? editShapeId : null}
              onAddPoint={onAddPoint}
              onDeleteShape={(id) => {
                setAnnotations((xs) => xs.filter((y) => y.id !== id));
                setEditShapeId((cur) => (cur === id ? null : cur));
              }}
              onEditShape={onEditShape}
              onMoveLabel={onMoveLabel}
            />
          ) : (
            <div className="empty">
              {sel.mode === 'none' ? (
                // The two ways in — stated up front, since the left panel is the
                // only entry point and neither path is obvious from the chrome.
                <div className="intro">
                  <h2>{t('startHere')}</h2>
                  <p>
                    <b>①</b> {t('introOotb')}
                  </p>
                  <p>
                    <b>②</b> {t('introAdd')}
                  </p>
                </div>
              ) : (
                <p>{t('needImage')}</p>
              )}
            </div>
          )}
          {/* CC BY / CC BY-SA oblige us to name the author wherever the image is
              shown, so this rides on the canvas rather than in a settings panel. */}
          {session?.credit && (
            <p className="credit">
              {session.sourceUrl ? (
                <a href={session.sourceUrl} target="_blank" rel="noreferrer">
                  {session.credit}
                </a>
              ) : (
                session.credit
              )}
              {session.license && <span className="lic">{session.license}</span>}
            </p>
          )}
        </main>

        {/* Right — annotation steps + export */}
        <aside className="panel steps-panel">
          {/* The pickers must exist in every flow; the visible upload block is
              placed per-flow (step ① of the wizard, or a trailing secondary
              action while reviewing). */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
              e.target.value = '';
            }}
          />
          <input
            ref={previewFileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f, { preview: true });
              e.target.value = '';
            }}
          />

          {/* Nothing is actionable until the left panel says what we're on. */}
          {sel.mode === 'none' && (
            <section className="locked">
              <h3>{t('pickFirst')}</h3>
              <p className="hint">{t('pickFirstHint')}</p>
            </section>
          )}

          {sel.mode !== 'none' && kind === 'new' && (
            <section>
              <StepHead n={1} title={t('stepUpload')} />
              {/* A seed target with no reference image yet: say why we're asking. */}
              {sel.mode === 'target' && !session && <p className="hint">{t('needRefFirst')}</p>}
              <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                {t('upload')}
              </button>
              {status && <p className="status">{status}</p>}
            </section>
          )}

          {/* ── Flow A · a NEW image: the full wizard ─────────────────────── */}
          {sel.mode !== 'none' && kind === 'new' && (
            <>
              <section className={session ? '' : 'locked'}>
                <StepHead n={2} title={t('stepIdentity')} />
                <label className="field-label">
                  {t('primaryId')} <span className="req">* {t('required')}</span>
                </label>
                <input
                  className={editable && !primaryId.trim() ? 'needs-value' : ''}
                  placeholder={t('primaryId')}
                  value={primaryId}
                  onChange={(e) => setPrimaryId(e.target.value)}
                />
                <input
                  placeholder={t('aliases')}
                  value={aliasesText}
                  onChange={(e) => setAliasesText(e.target.value)}
                />
                {session?.typeContext && (
                  <p className="type-context">
                    {t('typeLabel')}: {session.typeContext}
                  </p>
                )}
                {session?.identityNote && <p className="hint">{session.identityNote}</p>}
              </section>

              {session ? (
                <>
                  <section>
                    <StepHead n={3} title={t('stepDraw')} />
                    {drawControls}
                  </section>
                  <section>
                    <StepHead n={4} title={t('stepSave')} />
                    {annoList(true)}
                    {editShapeId && <p className="hint substeps">{t('adjustHint')}</p>}
                  </section>
                  {saveBlock(5)}
                </>
              ) : (
                <section className="locked">
                  <StepHead n={3} title={t('stepDraw')} />
                  <p className="hint">{t('needImage')}</p>
                </section>
              )}
            </>
          )}

          {/* ── Flow B · an EXISTING entry: review its annotations ────────── */}
          {session && kind === 'canonical' && (
            <>
              {/* Identity is already known — one summary line, expandable. */}
              <section className="ident-summary">
                <div className="ident-row">
                  <span className="ident-id">{primaryId}</span>
                  <span className="ident-meta">
                    {t('solvedSummary')} · {annotations.length}
                  </span>
                  <button className="adjust-btn" onClick={() => setIdOpen((v) => !v)}>
                    {idOpen ? t('collapse') : t('editIdentity')}
                  </button>
                </div>
                {idOpen && (
                  <>
                    <input value={primaryId} disabled={!editable} onChange={(e) => setPrimaryId(e.target.value)} />
                    <input
                      placeholder={t('aliases')}
                      value={aliasesText}
                      disabled={!editable}
                      onChange={(e) => setAliasesText(e.target.value)}
                    />
                  </>
                )}
              </section>

              {!editable ? (
                <section>
                  <p className="banner banner-preview">{t('previewOnly')}</p>
                  {annoList(false)}
                  {/* Three ways to work on an existing entry, side by side with
                      what each one actually does — they were previously two
                      buttons plus an unrelated upload block elsewhere. */}
                  <h3>{t('chooseAction')}</h3>
                  <div className="choices">
                    <button className="choice primary" onClick={() => setEditable(true)}>
                      <b>{t('actEdit')}</b>
                      <span>{t('actEditSub')}</span>
                    </button>
                    <button className="choice" onClick={() => previewFileRef.current?.click()}>
                      <b>{t('actVerify')}</b>
                      <span>{t('actVerifySub')}</span>
                    </button>
                    <button className="choice" onClick={() => fileRef.current?.click()}>
                      <b>{t('actReplace')}</b>
                      <span>{t('actReplaceSub')}</span>
                    </button>
                  </div>
                  {status && <p className="status">{status}</p>}
                </section>
              ) : (
                <>
                  <section className="review-main">
                    <StepHead n={1} title={t('stepReview')} />
                    <p className="banner banner-edit">{t('editingCanonical')}</p>
                    {annoList(true)}
                    <p className="hint substeps">{editShapeId ? t('adjustHint') : t('reviewHint')}</p>
                  </section>

                  {/* Adding another feature is the exception here — keep it shut. */}
                  <section>
                    <StepHead n={2} title={t('stepAddMore')} />
                    {addOpen ? (
                      <>
                        {drawControls}
                        {!drawing && (
                          <button className="wide-ghost" onClick={() => setAddOpen(false)}>
                            {t('collapse')}
                          </button>
                        )}
                      </>
                    ) : (
                      <button className="wide-ghost" onClick={() => setAddOpen(true)}>
                        {t('addMore')}
                      </button>
                    )}
                  </section>

                  {saveBlock(3)}
                </>
              )}
            </>
          )}

          {/* ── Flow C · verifying on another image: read-only ───────────── */}
          {session && kind === 'other' && (
            <section>
              <p className="banner banner-check">{t('checkingOther')}</p>
              {annoList(false)}
              <button className="primary" onClick={exitCheck}>
                {t('exitCheck')}
              </button>
            </section>
          )}

        </aside>
      </div>
    </div>
  );
}
