import type * as React from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { roleOfReading, type Reading, type FactSheet } from '@astellum/schema';
import { objectStem, type ExportFile } from '../shared.js';
import {
  exportProject,
  fetchFactsheet,
  fetchJob,
  fetchReport,
  generateReading,
  readPredefinedText,
  predefinedExists,
  savePredefined,
  saveAnnotations,
  annotationsToReplace,
  imageUrl,
  reidentify,
  saveReport,
} from './api.js';
import { initState, reducer, writtenPassages } from './state.js';
import { Canvas, FIT, MAX_ZOOM, zoomAt, type View } from './Canvas.js';
import { Sidebar } from './Sidebar.js';
import { FactsPanel } from './FactsPanel.js';
import { PosterPreview, type PreviewFormat } from './Preview.js';
import { LangToggle, useUi } from './i18n.js';
import { PRESETS, DEFAULT_ROLE_ID } from './presets.js';
import { getConfig } from './api.js';

const PREVIEW_FORMATS: PreviewFormat[] = ['annotated', 'landscape', 'portrait'];

/**
 * A face for each built-in role. Looked up by id, so a role a curator adds in
 * an overlay simply has none and shows as text.
 */
const ROLE_EMOJI: Record<string, string> = { primary: '🧒', adult: '🧑', teacher: '🧑‍🏫' };

type Picker = (options?: {
  mode?: 'read' | 'readwrite';
  startIn?: string;
  id?: string;
}) => Promise<FileSystemDirectoryHandle>;
type SavePicker = (options?: {
  suggestedName?: string;
  startIn?: string;
  id?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick — Safari/Firefox sometimes need the URL alive briefly.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EditorPage({ slug }: { slug: string }): React.JSX.Element {
  const { t } = useUi();
  const [data, setData] = useState<{ report: Reading; imageName: string } | null>(null);
  const [factsheet, setFactsheet] = useState<FactSheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setFactsheet(null);
    setError(null);
    fetchReport(slug)
      .then((r) => setData({ report: r.report, imageName: r.imageName }))
      .catch((e: unknown) => setError((e as Error).message));
    // best-effort: older projects may have no fact sheet
    fetchFactsheet(slug)
      .then((r) => setFactsheet(r.factsheet))
      .catch(() => setFactsheet(null));
  }, [slug]);

  if (error)
    return (
      <div className="status">
        {t.loadFailed}: {error} · <a href="#/">{t.backToLibrary}</a>
      </div>
    );
  if (!data) return <div className="status">{t.loading}</div>;
  return (
    <Editor
      key={slug}
      slug={slug}
      initial={data.report}
      imageName={data.imageName}
      factsheet={factsheet}
    />
  );
}

function Editor({
  slug,
  initial,
  imageName,
  factsheet: initialFactsheet,
}: {
  slug: string;
  initial: Reading;
  imageName: string;
  factsheet: FactSheet | null;
}): React.JSX.Element {
  const { t, lang: uiLang } = useUi();
  // Held here, not only passed in: a re-identification replaces it in place.
  const [factsheet, setFactsheet] = useState(initialFactsheet);
  const previewLabels: Record<PreviewFormat, string> = {
    annotated: t.pvAnnotated,
    landscape: t.pvLandscape,
    portrait: t.pvPortrait,
  };
  const previewExportLabels: Record<PreviewFormat, string> = {
    annotated: t.fmtAnnotated,
    landscape: t.fmtPosterLandscape,
    portrait: t.fmtPosterPortrait,
  };
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [saveError, setSaveError] = useState<string | null>(null);
  // Closed: the facts are for checking an identification, and a frame that
  // needs nothing should open on what is to be exported.
  const [factsOpen, setFactsOpen] = useState(false);
  const [readingOpen, setReadingOpen] = useState(true);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>('annotated');
  // Preview zoom. Only the view — the export is always the whole frame.
  const [view, setView] = useState<View>(FIT);
  const [reidentifying, setReidentifying] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Off by default: the grid is a checking aid, and what is on screen should be
  // what an export carries.
  const [showGrid, setShowGrid] = useState(false);
  const [presetIds, setPresetIds] = useState<Set<string>>(new Set());
  const [styleFree, setStyleFree] = useState('');
  const [savingPredef, setSavingPredef] = useState<'idle' | 'saving' | 'done'>('idle');
  const [savingAnns, setSavingAnns] = useState<'idle' | 'saving' | 'done'>('idle');
  // Style presets are curator copy: the server resolves the overlay over the
  // built-ins and sends the list that is actually in force.
  const [presets, setPresets] = useState(PRESETS);
  // Who this reading is for. One role is always in force — a reading is
  // written for somebody — and it is the same axis the library is keyed by,
  // so it decides both the prompt and which pre-written text is shown.
  // Opens on the role the text on screen belongs to — recorded in the reading,
  // or recognised from its tone — and only falls back to the default when
  // there is no telling (no text yet, or text from before either existed).
  const [role, setRole] = useState<string>(
    () => roleOfReading(initial, PRESETS) ?? DEFAULT_ROLE_ID,
  );
  // Whether a role change has text to re-read. `ai` means the model writes it,
  // and replacing its prose with the library's on a role change would throw
  // away the generation the curator is looking at.
  const [predefinedMode, setPredefinedMode] = useState(false);
  const [switchingRole, setSwitchingRole] = useState(false);
  useEffect(() => {
    getConfig()
      .then((c) => {
        if (c.stylePresets?.length) setPresets(c.stylePresets);
        setPredefinedMode(c.config.reading.mode === 'predefined');
        // An overlay may rename or drop the roles; follow the server rather
        // than sitting in one it no longer offers.
        const roles = (c.stylePresets?.length ? c.stylePresets : PRESETS).filter(
          (x) => x.group === 'audience',
        );
        const want = roleOfReading(initial, roles) ?? c.defaultRole ?? DEFAULT_ROLE_ID;
        setRole(roles.some((x) => x.id === want) ? want : (roles[0]?.id ?? want));
      })
      .catch(() => undefined);
  }, []);

  const togglePreset = (id: string): void =>
    setPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /**
   * What the model is told about its reader.
   *
   * The role first and always — the focus chips and the free-text box lean on
   * a reading that is already addressed to somebody, and sending them without
   * it used to leave the model guessing.
   */
  const buildTone = (): string | undefined => {
    const text = (p: { textZh: string; textEn: string }): string =>
      uiLang === 'en' ? p.textEn : p.textZh;
    const current = presets.find((p) => p.group === 'audience' && p.id === role);
    const parts = current ? [text(current)] : [];
    for (const p of presets) {
      if (p.group !== 'audience' && presetIds.has(p.id)) parts.push(text(p));
    }
    if (styleFree.trim()) parts.push(styleFree.trim());
    return parts.join('\n') || undefined;
  };
  const appRef = useRef<HTMLDivElement>(null);
  const [editW, setEditW] = useState<number | null>(null); // null = default share

  // Drag the edit | preview boundary.
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const move = (ev: MouseEvent): void => {
      const rect = appRef.current?.getBoundingClientRect();
      if (!rect) return;
      setEditW(Math.min(rect.width * 0.6, Math.max(300, ev.clientX - rect.left)));
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const [exporting, setExporting] = useState<string | null>(null);
  const [exported, setExported] = useState<{ dir: string | null; files: string[] } | null>(null);

  const doSave = useCallback(async () => {
    try {
      await saveReport(slug, stateRef.current.report);
      dispatch({ type: 'markSaved' });
      setSaveError(null);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }, [slug]);

  /**
   * Ask before anything that replaces what is already there. One rule for
   * every such action — generating, switching role, saving to the library,
   * exporting into a folder — so nobody has to remember which ones ask.
   * In-page, like the re-identify popover, not a native dialog.
   */
  const [ask, setAsk] = useState<{
    message: string;
    confirm: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const confirmOverwrite = (message: string, confirm: string): Promise<boolean> =>
    new Promise((resolve) => setAsk({ message, confirm, resolve }));
  /** The same dialog with a text box: a name, or null when cancelled. */
  const [naming, setNaming] = useState<{
    message: string;
    value: string;
    confirm: string;
    resolve: (v: string | null) => void;
  } | null>(null);
  const promptName = (message: string, value: string, confirm: string): Promise<string | null> =>
    new Promise((resolve) => setNaming({ message, value, confirm, resolve }));
  const answerName = (v: string | null): void => {
    naming?.resolve(v);
    setNaming(null);
  };
  const answer = (ok: boolean): void => {
    ask?.resolve(ok);
    setAsk(null);
  };
  const roleName = (id: string): string => {
    const p = presets.find((x) => x.group === 'audience' && x.id === id);
    return p ? (uiLang === 'zh' ? p.labelZh : p.labelEn) : id;
  };

  const doSavePredefined = async (): Promise<void> => {
    setSaveError(null);
    try {
      // The library is shared by every project of this target, so replacing
      // its text reaches further than this page.
      if (
        (await predefinedExists(slug, role)) &&
        !(await confirmOverwrite(
          t.predefOverwrite.replace('{role}', roleName(role)),
          t.predefOverwriteBtn,
        ))
      )
        return;
    } catch (e) {
      setSaveError((e as Error).message);
      return;
    }
    setSavingPredef('saving');
    try {
      if (stateRef.current.dirty) await doSave(); // save edits before promoting them
      // Promoted under the role it was written for, so the kiosk's role
      // switch finds it where it looks.
      await savePredefined(slug, role);
      setSavingPredef('done');
    } catch (e) {
      setSaveError((e as Error).message);
      setSavingPredef('idle');
    }
  };

  const doSaveAnnotations = async (): Promise<void> => {
    setSaveError(null);
    try {
      if (stateRef.current.dirty) await doSave(); // the check reads the saved reading
      const n = await annotationsToReplace(slug);
      if (n > 0 && !(await confirmOverwrite(t.annsOverwrite.replace('{n}', String(n)), t.annsOverwriteBtn)))
        return;
    } catch (e) {
      setSaveError((e as Error).message);
      return;
    }
    setSavingAnns('saving');
    try {
      if (stateRef.current.dirty) await doSave();
      await saveAnnotations(slug);
      setSavingAnns('done');
    } catch (e) {
      setSaveError((e as Error).message);
      setSavingAnns('idle');
    }
  };

  /**
   * Pick up what the server just rewrote, in place. It used to reload the
   * page, which put everything the curator had set back to its default — the
   * role among them, so a role switch in `predefined` mode could never stick.
   */
  const refresh = async (withFacts = false): Promise<void> => {
    const r = await fetchReport(slug);
    dispatch({ type: 'replace', report: r.report });
    if (withFacts) setFactsheet(await fetchFactsheet(slug).then((x) => x.factsheet, () => null));
  };

  const doGenerate = async (tone?: string): Promise<void> => {
    const n = writtenPassages(stateRef.current.report);
    if (n > 0 && !(await confirmOverwrite(t.genOverwrite.replace('{n}', String(n)), t.genOverwriteBtn)))
      return;
    setGenerating(true);
    setSaveError(null);
    try {
      if (stateRef.current.dirty) await doSave(); // persist reviewed annotations first
      await generateReading(slug, tone, role);
      for (;;) {
        const s = await fetchJob(slug);
        if (s.state === 'done') break;
        if (s.state === 'failed') throw new Error(s.error ?? 'reading failed');
        await new Promise((r) => setTimeout(r, 2000));
      }
      await refresh();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Switch role.
   *
   * On the predefined side this re-reads the library — a second, no
   * network. In `ai` mode there is nothing to re-read: the role is simply
   * who the next generation is for, so changing it only changes the prompt.
   */
  const doSetRole = async (next: string): Promise<void> => {
    if (!predefinedMode) {
      setRole(next);
      return;
    }
    const n = writtenPassages(stateRef.current.report);
    if (
      n > 0 &&
      !(await confirmOverwrite(
        t.roleOverwrite.replace('{role}', roleName(next)).replace('{n}', String(n)),
        t.roleOverwriteBtn,
      ))
    )
      return; // the radio is controlled, so it stays on the role in force
    setRole(next);
    setSwitchingRole(true);
    setSaveError(null);
    try {
      if (stateRef.current.dirty) await doSave(); // the server rewrites the saved file
      await readPredefinedText(slug, next);
      await refresh();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSwitchingRole(false);
    }
  };

  const doReidentify = async (opts: { starMagMax?: number }): Promise<void> => {
    setReidentifying(true);
    setSaveError(null);
    try {
      // The role travels with it: a re-identification in `predefined` mode
      // fills the text in again, and it should come back in the role on
      // screen rather than the configured default.
      await reidentify(slug, { ...opts, role }); // re-run Stage 1 on the stored image
      for (;;) {
        const s = await fetchJob(slug);
        if (s.state === 'done') break;
        if (s.state === 'failed') throw new Error(s.error ?? 'identification failed');
        await new Promise((r) => setTimeout(r, 2000));
      }
      await refresh(true); // a fresh fact sheet as well as a fresh reading
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setReidentifying(false);
    }
  };


  useEffect(() => {
    if (!state.dirty) return;
    const t = setTimeout(() => void doSave(), 2000);
    return () => clearTimeout(t);
  }, [state.report, state.dirty, doSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const editable =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === 'Escape' && !editable && stateRef.current.selectedId) {
        dispatch({ type: 'select', id: null });
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        void doSave();
        return;
      }
      if (mod && key === 'z') {
        if (editable) return;
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && key === 'y') {
        if (editable) return;
        e.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (!editable && e.key.startsWith('Arrow')) {
        const sel = stateRef.current.selectedId;
        if (!sel) return;
        const step = e.shiftKey ? 10 : 1;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const d = delta[e.key];
        if (d) {
          e.preventDefault();
          dispatch({ type: 'nudge', id: sel, dx: d[0], dy: d[1] });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSave]);

  /** Write one exported file through a handle, and check it landed whole. */
  const writeFile = async (fh: FileSystemFileHandle, f: ExportFile): Promise<string> => {
    if (!f.base64) throw new Error(`Empty payload for ${f.name}`);
    const bytes = base64ToBytes(f.base64);
    const w = await fh.createWritable();
    await w.write(new Blob([bytes], { type: f.contentType }));
    await w.close();
    const onDisk = await fh.getFile();
    if (onDisk.size !== bytes.length)
      throw new Error(`${fh.name}: wrote ${bytes.length} bytes but file is ${onDisk.size} bytes on disk`);
    return `${fh.name} (${formatSize(onDisk.size)})`;
  };
  const download = (f: ExportFile, name = f.name): string => {
    const bytes = base64ToBytes(f.base64);
    downloadBlob(new Blob([bytes], { type: f.contentType }), name);
    return `${name} (${formatSize(bytes.length)})`;
  };
  const stem = (): string =>
    objectStem(stateRef.current.report.object.name.en || stateRef.current.report.object.name.zh);

  /**
   * The format on screen, as one file, through the system's Save dialog — so
   * the name and the place are chosen there, and so is replacing a file of
   * the same name (the dialog asks). Opened before anything is fetched: the
   * browser only allows it straight from the click. Where there is no such
   * dialog (Safari, Firefox) the file goes to the browser's downloads.
   */
  const exportOne = async (): Promise<void> => {
    const poster = previewFormat !== 'annotated';
    const ext = poster ? '.png' : '.jpg';
    const mime = poster ? 'image/png' : 'image/jpeg';
    const label = previewExportLabels[previewFormat];
    const suggestedName = poster ? `${stem()}_poster-${previewFormat}${ext}` : `${stem()}_annotated${ext}`;

    let fh: FileSystemFileHandle | null = null;
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (picker) {
      try {
        fh = await picker({
          suggestedName,
          id: 'astellum-export',
          startIn: 'downloads',
          types: [{ description: label, accept: { [mime]: [ext] } }],
        });
      } catch {
        return; // cancelled
      }
    }

    setExported(null);
    setExporting(label);
    try {
      if (stateRef.current.dirty) await doSave();
      const files = await exportProject(
        slug,
        poster ? 'poster' : 'annotated',
        poster ? (previewFormat as 'portrait' | 'landscape') : undefined,
        uiLang,
      );
      const f = files.find((x) => x.contentType === mime);
      if (!f) throw new Error('Server returned no image');
      const written = fh ? await writeFile(fh, f) : download(f, suggestedName);
      setExported({ dir: fh ? null : t.browserDefault, files: [written] });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  /**
   * Every format at once, as a set: named as a folder of its own, which goes
   * wherever the curator puts it. The folder is only created once the files
   * are in hand, and anything of the same name inside it is asked about.
   */
  const exportAll = async (): Promise<void> => {
    const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
    let parent: FileSystemDirectoryHandle | null = null;
    let folder = '';
    if (picker) {
      const asked = await promptName(t.exportAllPrompt, stem(), t.exportAllPickBtn);
      if (asked === null) return;
      folder = asked.replace(/[/\\:*?"<>|]+/g, '-').trim();
      if (!folder) return;
      try {
        // Straight from the dialog's button, which is the click the browser needs.
        parent = await picker({ mode: 'readwrite', startIn: 'downloads', id: 'astellum-export' });
      } catch {
        return; // cancelled
      }
    }

    setExported(null);
    setExporting(t.fmtAll);
    try {
      if (stateRef.current.dirty) await doSave();
      const files = await exportProject(slug, 'all', undefined, uiLang);
      if (files.length === 0) throw new Error('Server returned no files');

      if (!parent) {
        setExported({ dir: t.browserDefault, files: files.map((f) => download(f)) });
        return;
      }
      const existing = await parent.getDirectoryHandle(folder).catch(() => null);
      if (existing) {
        const clashes: string[] = [];
        for (const f of files) {
          if (await existing.getFileHandle(f.name).then(() => true, () => false)) clashes.push(f.name);
        }
        if (
          clashes.length &&
          !(await confirmOverwrite(
            t.exportOverwrite.replace('{files}', clashes.join(t.listSep)),
            t.exportOverwriteBtn,
          ))
        )
          return;
      }
      const dir = existing ?? (await parent.getDirectoryHandle(folder, { create: true }));
      const written: string[] = [];
      for (const f of files) written.push(await writeFile(await dir.getFileHandle(f.name, { create: true }), f));
      setExported({ dir: `${parent.name}/${folder}`, files: written });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  const canvas = (
    <Canvas
      report={state.report}
      selectedId={state.selectedId}
      dispatch={dispatch}
      imageUrl={imageUrl(slug)}
      gridWcs={factsheet?.solve.wcs ?? null}
      showGrid={showGrid}
      lang={uiLang}
      view={view}
      onView={setView}
      wheelZooms={previewFormat === 'annotated'}
    />
  );

  return (
    <div className="editor-page">
      <header className="toolbar">
        <a className="home-link" href="#/">
          {t.backToLibrary}
        </a>
        <span className="toolbar-title">{state.report.object.name[uiLang]}</span>
        <LangToggle />
      </header>

      <div className="app" ref={appRef}>
        {/* Left: everything that changes the frame. Marked as such, because
            the frame on the right is already exportable as it stands — this
            column is where you go only when something needs fixing. */}
        <div className="edit-col" style={editW != null ? { flex: `0 0 ${editW}px` } : undefined}>
          <header className="col-head">
            <span className="col-title">✏️ {t.editTitle}</span>
            <span className="col-sub">{t.editSub}</span>
          </header>
          <div className="edit-body">
            <section className="edit-panel">
              <button className="edit-panel-head" onClick={() => setFactsOpen((v) => !v)}>
                <span className="fold">{factsOpen ? '▾' : '▸'}</span>
                🔭 {t.panelFacts}
              </button>
              {factsOpen && (
                <FactsPanel
                  reading={state.report}
                  factsheet={factsheet}
                  selectedId={state.selectedId}
                  onSelect={(id) => dispatch({ type: 'select', id })}
                  onReidentify={(opts) => void doReidentify(opts)}
                  reidentifying={reidentifying}
                  actions={
                    // The annotations themselves, so the next image of this
                    // target starts from this work instead of a blank frame.
                    <button
                      className="save-predefined"
                      disabled={savingAnns === 'saving'}
                      onClick={() => void doSaveAnnotations()}
                    >
                      {savingAnns === 'saving'
                        ? t.savingPredefined
                        : savingAnns === 'done'
                          ? `✓ ${t.savedAnnotations}`
                          : t.saveAnnotations}
                    </button>
                  }
                />
              )}
            </section>

            <section className="edit-panel">
              <button className="edit-panel-head" onClick={() => setReadingOpen((v) => !v)}>
                <span className="fold">{readingOpen ? '▾' : '▸'}</span>
                ✍️ {t.panelReading}
              </button>
              {readingOpen && (
                <div className="reading-panel">
                  {/* Who this is for. A single choice in plain view: it is not
                      only a prompt instruction — it is the key the predefined
                      library is read by, so it means something even with no
                      model in reach. */}
                  <div className="role-cards" role="radiogroup" aria-label={t.roleLabel}>
                    <span className="field-label">{t.roleLabel}</span>
                    <div className="role-row">
                      {presets
                        .filter((p) => p.group === 'audience')
                        .map((p) => (
                          <label key={p.id} className={`role-card${role === p.id ? ' active' : ''}`}>
                            <input
                              type="radio"
                              name="role"
                              value={p.id}
                              checked={role === p.id}
                              disabled={switchingRole || generating}
                              onChange={() => void doSetRole(p.id)}
                            />
                            {ROLE_EMOJI[p.id] && <span className="role-emoji">{ROLE_EMOJI[p.id]}</span>}
                            <span>{uiLang === 'zh' ? p.labelZh : p.labelEn}</span>
                          </label>
                        ))}
                    </div>
                  </div>
                  {/* What is left leans on a reading that is already addressed
                      to somebody: stackable sentences, not a second role. */}
                  <div className="chip-group">
                    <span className="chip-group-label">{t.focusLabel}</span>
                    {presets
                      .filter((p) => p.group === 'focus')
                      .map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          className={`chip${presetIds.has(p.id) ? ' active' : ''}`}
                          onClick={() => togglePreset(p.id)}
                        >
                          {uiLang === 'zh' ? p.labelZh : p.labelEn}
                        </button>
                      ))}
                  </div>
                  <input
                    className="style-free"
                    placeholder={t.styleFreePlaceholder}
                    value={styleFree}
                    onChange={(e) => setStyleFree(e.target.value)}
                  />
                  <div className="reading-actions">
                    <button
                      className="primary gen-reading"
                      onClick={() => void doGenerate(buildTone())}
                      disabled={generating}
                    >
                      {generating ? t.genReadingRunning : t.genReading}
                    </button>
                    {/* The other half of the loop: a reading you're happy with
                        becomes this target's offline text, so onsite gets it
                        for free. */}
                    {state.report.features.some((f) => f.explanation.zh || f.explanation.en) && (
                      <button
                        className="save-predefined"
                        disabled={savingPredef === 'saving'}
                        onClick={() => void doSavePredefined()}
                      >
                        {savingPredef === 'saving'
                          ? t.savingPredefined
                          : savingPredef === 'done'
                            ? `✓ ${t.savedPredefined}`
                            : t.savePredefined}
                      </button>
                    )}
                  </div>
                  <Sidebar
                    report={state.report}
                    imageName={imageName}
                    selectedId={state.selectedId}
                    dirty={state.dirty}
                    dispatch={dispatch}
                    onSave={() => void doSave()}
                  />
                </div>
              )}
            </section>
          </div>
        </div>
        <div className="divider" onMouseDown={startDrag} title={t.dragDivider} />

        {/* Right: the frame as it will leave. Export sits under it, so the
            button writes exactly what is on screen. */}
        <div className="preview-col">
          <header className="col-head">
            <span className="col-title">👁 {t.previewTitle}</span>
            {/* A checking aid, never exported — so it sits up here rather
                than on the picture it would otherwise cover. */}
            {factsheet?.solve.wcs && (
              <button
                className={`grid-toggle${showGrid ? ' active' : ''}`}
                onClick={() => setShowGrid((v) => !v)}
              >
                {showGrid ? t.gridHide : t.gridShow}
              </button>
            )}
            <div className="zoom-ctl" role="group" aria-label={t.zoomLabel}>
              <button
                onClick={() => setView((v) => zoomAt(v, 1 / 1.5))}
                disabled={view.k <= 1}
                title={t.zoomOut}
              >
                −
              </button>
              <button onClick={() => setView(FIT)} title={t.zoomFit}>
                {Math.round(view.k * 100)}%
              </button>
              <button
                onClick={() => setView((v) => zoomAt(v, 1.5))}
                disabled={view.k >= MAX_ZOOM}
                title={t.zoomIn}
              >
                +
              </button>
            </div>
            <div className="fmt-tabs" role="radiogroup" aria-label={t.previewTitle}>
              {PREVIEW_FORMATS.map((f) => (
                <label key={f} className={`fmt-tab${previewFormat === f ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="preview-format"
                    checked={previewFormat === f}
                    onChange={() => {
                      setPreviewFormat(f);
                      setView(FIT); // a different box; start from the whole picture
                    }}
                  />
                  {previewLabels[f]}
                </label>
              ))}
            </div>
          </header>
          {/* The preview is also where marks are moved, which nothing about a
              preview suggests — so it says so, once, above the picture. */}
          <p className="preview-hint">✋ {t.previewHint}</p>
          <div className={`preview-body preview-${previewFormat}`}>
            <PosterPreview
              report={state.report}
              format={previewFormat}
              canvas={canvas}
              lang={uiLang}
            />
          </div>
          <footer className="export-bar">
            <button
              className="primary export-main"
              disabled={exporting !== null}
              onClick={() => void exportOne()}
            >
              {exporting
                ? `${t.exporting} (${exporting})`
                : `⬇ ${t.exportLabel} ${previewExportLabels[previewFormat]}`}
            </button>
            {/* The preview's own format is the main button; this is the rest
                in one go — the frame and both posters. */}
            <button
              className="export-all"
              onClick={() => void exportAll()}
              disabled={exporting !== null}
            >
              {t.exportAll}
            </button>
          </footer>
        </div>
      </div>

      {exported && (
        <div className="export-result">
          <span>
            {exported.dir ? (
              <>
                {t.savedTo} <b>{exported.dir}/</b>
              </>
            ) : (
              t.exported
            )}
          </span>
          {exported.files.map((name) => (
            <span key={name} className="exported-file">
              {name}
            </span>
          ))}
          <button className="dismiss" onClick={() => setExported(null)}>
            ✕
          </button>
        </div>
      )}
      {saveError && <div className="save-error">{t.errorLabel}: {saveError}</div>}

      {naming && (
        <div className="overlay" onClick={() => answerName(null)}>
          <form
            className="confirm-box"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              answerName(naming.value);
            }}
          >
            <label className="name-prompt">
              <span>{naming.message}</span>
              <input
                autoFocus
                value={naming.value}
                onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div className="reid-actions">
              <button type="button" onClick={() => answerName(null)}>
                {t.reidCancel}
              </button>
              <button type="submit" className="primary" disabled={!naming.value.trim()}>
                {naming.confirm}
              </button>
            </div>
          </form>
        </div>
      )}

      {ask && (
        <div className="overlay" onClick={() => answer(false)}>
          <div className="confirm-box" role="alertdialog" onClick={(e) => e.stopPropagation()}>
            <p className="reid-danger">⚠ {ask.message}</p>
            <div className="reid-actions">
              <button autoFocus onClick={() => answer(false)}>
                {t.reidCancel}
              </button>
              <button className="danger" onClick={() => answer(true)}>
                {ask.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {(reidentifying || generating || switchingRole) && (
        <div className="overlay">
          <div className="overlay-box">
            {generating
              ? t.genReadingRunning
              : switchingRole
                ? t.switchingRole
                : t.reidentifying}
            <p className="muted">{generating ? t.stageReading : t.stageSolving}</p>
          </div>
        </div>
      )}
    </div>
  );
}
