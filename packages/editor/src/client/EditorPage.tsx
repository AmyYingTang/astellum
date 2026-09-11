import type * as React from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Reading, FactSheet } from '@astellum/schema';
import type { ExportFormat } from '../shared.js';
import {
  exportProject,
  fetchFactsheet,
  fetchJob,
  fetchReport,
  generateReading,
  savePredefined,
  saveAnnotations,
  imageUrl,
  reidentify,
  saveReport,
} from './api.js';
import { initState, reducer } from './state.js';
import { Canvas } from './Canvas.js';
import { Sidebar } from './Sidebar.js';
import { FactsPanel } from './FactsPanel.js';
import { LangToggle, useUi } from './i18n.js';
import { PRESETS } from './presets.js';
import { getConfig } from './api.js';

const EXPORT_ORDER: ExportFormat[] = ['annotated', 'embed', 'poster', 'all'];

type SaveMode = 'folder' | 'download';
const SAVE_MODE_KEY = 'astellum.saveMode';

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
  factsheet,
}: {
  slug: string;
  initial: Reading;
  imageName: string;
  factsheet: FactSheet | null;
}): React.JSX.Element {
  const { t, lang: uiLang } = useUi();
  const exportLabels: Record<ExportFormat, string> = {
    annotated: t.fmtAnnotated,
    embed: t.fmtEmbed,
    poster: t.fmtPoster,
    all: t.fmtAll,
  };
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [factsCollapsed, setFactsCollapsed] = useState(false);
  const [reidentifying, setReidentifying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [genMenuOpen, setGenMenuOpen] = useState(false);
  const [presetIds, setPresetIds] = useState<Set<string>>(new Set());
  const [styleFree, setStyleFree] = useState('');
  const [savingPredef, setSavingPredef] = useState<'idle' | 'saving' | 'done'>('idle');
  const [savingAnns, setSavingAnns] = useState<'idle' | 'saving' | 'done'>('idle');
  // Style presets are curator copy: the server sends them when a content
  // overlay supplies them, otherwise the built-in list stands.
  const [presets, setPresets] = useState(PRESETS);
  useEffect(() => {
    getConfig()
      .then((c) => c.stylePresets?.length && setPresets(c.stylePresets))
      .catch(() => undefined);
  }, []);

  const togglePreset = (id: string): void =>
    setPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const buildTone = (): string | undefined => {
    const parts = presets.filter((p) => presetIds.has(p.id)).map((p) =>
      uiLang === 'en' ? p.textEn : p.textZh,
    );
    if (styleFree.trim()) parts.push(styleFree.trim());
    return parts.join('\n') || undefined;
  };
  const appRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState<number | null>(null); // null = default proportions
  const [factsW, setFactsW] = useState<number | null>(null); // null = default 20%

  const factsPx = (rectWidth: number): number =>
    factsCollapsed ? 36 : (factsW ?? rectWidth * 0.2);

  // Drag the facts | image boundary.
  const startDragFacts = (e: React.MouseEvent): void => {
    e.preventDefault();
    const move = (ev: MouseEvent): void => {
      const rect = appRef.current?.getBoundingClientRect();
      if (!rect) return;
      setFactsW(Math.min(rect.width * 0.5, Math.max(160, ev.clientX - rect.left)));
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Drag the image | text boundary.
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const move = (ev: MouseEvent): void => {
      const rect = appRef.current?.getBoundingClientRect();
      if (!rect) return;
      const fW = factsPx(rect.width);
      const w = Math.min(rect.width - fW - 320, Math.max(240, ev.clientX - rect.left - fW));
      setCanvasW(w);
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exported, setExported] = useState<{ dir: string; files: string[] } | null>(null);
  const [saveMode, setSaveModeState] = useState<SaveMode>(
    () => (localStorage.getItem(SAVE_MODE_KEY) as SaveMode | null) ?? 'folder',
  );
  const setSaveMode = (m: SaveMode): void => {
    localStorage.setItem(SAVE_MODE_KEY, m);
    setSaveModeState(m);
  };

  const doSave = useCallback(async () => {
    try {
      await saveReport(slug, stateRef.current.report);
      dispatch({ type: 'markSaved' });
      setSaveError(null);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }, [slug]);

  const doSavePredefined = async (): Promise<void> => {
    setSavingPredef('saving');
    setSaveError(null);
    try {
      if (stateRef.current.dirty) await doSave(); // save edits before promoting them
      await savePredefined(slug);
      setSavingPredef('done');
    } catch (e) {
      setSaveError((e as Error).message);
      setSavingPredef('idle');
    }
  };

  const doSaveAnnotations = async (): Promise<void> => {
    setSavingAnns('saving');
    setSaveError(null);
    try {
      if (stateRef.current.dirty) await doSave();
      await saveAnnotations(slug);
      setSavingAnns('done');
    } catch (e) {
      setSaveError((e as Error).message);
      setSavingAnns('idle');
    }
  };

  const doGenerate = async (tone?: string): Promise<void> => {
    setGenMenuOpen(false);
    setGenerating(true);
    setSaveError(null);
    try {
      if (stateRef.current.dirty) await doSave(); // persist reviewed annotations first
      await generateReading(slug, tone);
      for (;;) {
        const s = await fetchJob(slug);
        if (s.state === 'done') break;
        if (s.state === 'failed') throw new Error(s.error ?? 'reading failed');
        await new Promise((r) => setTimeout(r, 2000));
      }
      location.reload(); // reload to show the AI explanations
    } catch (e) {
      setSaveError((e as Error).message);
      setGenerating(false);
    }
  };

  const doReidentify = async (opts: { starMagMax?: number }): Promise<void> => {
    setReidentifying(true);
    setSaveError(null);
    try {
      await reidentify(slug, opts); // re-run Stage 1 on the stored image
      for (;;) {
        const s = await fetchJob(slug);
        if (s.state === 'done') break;
        if (s.state === 'failed') throw new Error(s.error ?? 'identification failed');
        await new Promise((r) => setTimeout(r, 2000));
      }
      location.reload(); // reload to pick up the fresh factsheet + reading
    } catch (e) {
      setSaveError((e as Error).message);
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

  const runExport = async (format: ExportFormat): Promise<void> => {
    setMenuOpen(false);

    let dirHandle: FileSystemDirectoryHandle | null = null;
    if (saveMode === 'folder') {
      type Picker = (options?: {
        mode?: 'read' | 'readwrite';
        startIn?: string;
        id?: string;
      }) => Promise<FileSystemDirectoryHandle>;
      const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
      if (!picker) {
        setSaveError(t.pickerUnsupported);
        return;
      }
      try {
        dirHandle = await picker({ mode: 'readwrite', startIn: 'downloads', id: 'astellum-export' });
      } catch {
        return; // user cancelled the picker
      }
    }

    setExported(null);
    setExporting(format);
    try {
      if (stateRef.current.dirty) await doSave();

      if (dirHandle) {
        const reqPerm =
          (dirHandle as unknown as { requestPermission?: (o: { mode: string }) => Promise<string> })
            .requestPermission;
        if (reqPerm) {
          const state = await reqPerm.call(dirHandle, { mode: 'readwrite' });
          if (state !== 'granted')
            throw new Error(`Write permission ${state} for ${dirHandle.name}`);
        }
      }

      const files = await exportProject(slug, format);
      if (files.length === 0) throw new Error('Server returned no files');

      const written: string[] = [];
      for (const f of files) {
        if (!f.base64) throw new Error(`Empty payload for ${f.name}`);
        const bytes = base64ToBytes(f.base64);
        const blob = new Blob([bytes], { type: f.contentType });

        if (dirHandle) {
          const fh = await dirHandle.getFileHandle(f.name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
          const onDisk = await fh.getFile();
          if (onDisk.size !== bytes.length) {
            throw new Error(
              `${f.name}: wrote ${bytes.length} bytes but file is ${onDisk.size} bytes on disk`,
            );
          }
          written.push(`${f.name} (${formatSize(onDisk.size)})`);
        } else {
          downloadBlob(blob, f.name);
          written.push(`${f.name} (${formatSize(bytes.length)})`);
        }
      }
      setExported({ dir: dirHandle ? dirHandle.name : t.browserDefault, files: written });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

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
        <FactsPanel
          reading={state.report}
          factsheet={factsheet}
          selectedId={state.selectedId}
          onSelect={(id) => dispatch({ type: 'select', id })}
          collapsed={factsCollapsed}
          onToggleCollapse={() => setFactsCollapsed((v) => !v)}
          onReidentify={(opts) => void doReidentify(opts)}
          reidentifying={reidentifying}
          style={!factsCollapsed && factsW != null ? { flex: `0 0 ${factsW}px` } : undefined}
        />
        {!factsCollapsed && <div className="divider" onMouseDown={startDragFacts} title="拖动调整 facts / 图像宽度" />}
        <Canvas
          report={state.report}
          selectedId={state.selectedId}
          dispatch={dispatch}
          imageUrl={imageUrl(slug)}
          style={canvasW != null ? { flex: `0 0 ${canvasW}px` } : undefined}
          gridWcs={factsheet?.solve.wcs ?? null}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid((v) => !v)}
        />
        <div className="divider" onMouseDown={startDrag} title="拖动调整图像 / 文字宽度" />
        <div className="text-col" style={canvasW != null ? { flex: '1 1 0' } : undefined}>
          <div className="text-actions">
            <div className="gen">
              <button
                className="primary gen-reading"
                onClick={() => setGenMenuOpen((v) => !v)}
                disabled={generating}
              >
                {generating ? t.genReadingRunning : `${t.genReading} ▾`}
              </button>
              {genMenuOpen && (
                <div className="gen-menu">
                  <span className="field-label">{t.styleLabel}</span>
                  {(['audience', 'focus'] as const).map((group) => (
                    <div className="chip-group" key={group}>
                      <span className="chip-group-label">
                        {group === 'audience' ? t.audienceLabel : t.focusLabel}
                      </span>
                      {presets.filter((p) => p.group === group).map((p) => (
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
                  ))}
                  <input
                    className="style-free"
                    placeholder={t.styleFreePlaceholder}
                    value={styleFree}
                    onChange={(e) => setStyleFree(e.target.value)}
                  />
                  <button className="primary" onClick={() => void doGenerate(buildTone())}>
                    {t.genReading}
                  </button>
                </div>
              )}
              {/* The other half of the loop: a reading you're happy with becomes
                  this target's offline text, so onsite gets it for free. */}
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
              {/* And the annotations themselves, so the next image of this
                  target starts from this work instead of a blank frame. */}
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
            </div>
            <div className="export">
              <button onClick={() => setMenuOpen((v) => !v)} disabled={exporting !== null}>
                {exporting ? `${t.exporting} (${exporting})` : `${t.exportLabel} ▾`}
              </button>
              {menuOpen && (
                <div className="export-menu">
                  <div className="mode-row">
                    <button
                      className={saveMode === 'folder' ? 'active' : ''}
                      onClick={() => setSaveMode('folder')}
                    >
                      {t.saveModeFolder}
                    </button>
                    <button
                      className={saveMode === 'download' ? 'active' : ''}
                      onClick={() => setSaveMode('download')}
                    >
                      {t.saveModeDownload}
                    </button>
                  </div>
                  {EXPORT_ORDER.map((format) => (
                    <button key={format} onClick={() => void runExport(format)}>
                      {exportLabels[format]}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
      </div>

      {exported && (
        <div className="export-result">
          <span>
            {t.savedTo} <b>{exported.dir}/</b>
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

      {(reidentifying || generating) && (
        <div className="overlay">
          <div className="overlay-box">
            {generating ? t.genReadingRunning : t.reidentifying}
            <p className="muted">{generating ? t.stageReading : t.stageSolving}</p>
          </div>
        </div>
      )}
    </div>
  );
}
