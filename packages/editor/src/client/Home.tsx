import type * as React from 'react';
import { useEffect, useState } from 'react';
import type { ConfigResponse, ProjectSummary } from '../shared.js';
import { createProject, fetchJob, getConfig, imageUrl, listProjects, setProfile } from './api.js';
import { LangToggle, useUi } from './i18n.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export function Home(): React.JSX.Element {
  const { t, lang: uiLang } = useUi();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
    getConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  // Switching profile is the whole point of the control file: one field decides
  // solver, catalogs, whether the text is written by the LLM or read from the
  // curated library, and how tightly candidates are filtered.
  const switchProfile = async (name: string): Promise<void> => {
    try {
      await setProfile(name);
      setConfig(await getConfig());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Home only runs Stage 1 (identify). The AI reading is generated later from the
  // editor, after the user has reviewed the annotations.
  const identify = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      const slug = await createProject({
        imageBase64: dataUrl,
        filename: file.name,
        hint: hint || undefined,
        lang: uiLang, // display language defaults to the UI language; switchable in the editor
      });
      for (;;) {
        const status = await fetchJob(slug);
        if (status.state === 'done') break;
        if (status.state === 'failed') throw new Error(status.error ?? 'identification failed');
        await sleep(2000);
      }
      location.hash = `#/p/${encodeURIComponent(slug)}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <div className="home-header">
        <h1 className="home-title">astrolens</h1>
        <div className="home-header-actions">
          {config && (
            <div className="profile-box">
              <label className="profile-pick">
                <span>{t.profileLabel}</span>
                <select
                  value={config.profileName}
                  onChange={(e) => void switchProfile(e.target.value)}
                >
                  {config.profiles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <span
                className={`solver-badge${config.localSolver ? ' local' : ''}`}
                title={
                  config.localSolver
                    ? 'Offline local astrometry.net'
                    : 'Remote nova.astrometry.net — needs network'
                }
              >
                {t.solverLabel}: {config.solver} · {config.profile.reading.mode}
              </span>
              {config.offlineCatalog && config.readiness && (
                <span
                  className={`ready-badge${config.readiness.catalogsReady ? ' ok' : ' warn'}`}
                  title={
                    config.readiness.catalogsReady
                      ? ''
                      : `missing: ${config.readiness.missingCatalogs.join(', ')}`
                  }
                >
                  {config.readiness.catalogsReady ? t.readyOffline : t.notReadyOffline}
                </span>
              )}
              {config.profile.reading.mode === 'predefined' && config.readiness && (
                <span className="ready-badge">
                  {t.readingsCovered} {config.readiness.readingsCovered}/
                  {config.readiness.readingTargets}
                </span>
              )}
            </div>
          )}
          <a
            className="atlas-link"
            href={`http://${window.location.hostname}:3100`}
            target="_blank"
            rel="noreferrer"
          >
            {t.atlasLink} ↗
          </a>
          <LangToggle />
        </div>
      </div>

      <section className="home-card">
        <h2>{t.newReading}</h2>
        <p className="muted">{t.newReadingDesc}</p>
        <label className="file-pick">
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span>{file ? file.name : t.pickImage}</span>
        </label>
        <div className="row">
          <input placeholder={t.hintPlaceholder} value={hint} onChange={(e) => setHint(e.target.value)} />
        </div>
        <button className="primary" disabled={!file || busy} onClick={() => void identify()}>
          {busy ? t.identifying : t.btnIdentify}
        </button>
        {error && <p className="err">{error}</p>}
      </section>

      <section className="home-card">
        <h2>{t.openExisting}</h2>
        {projects === null && <p className="muted">{t.loading}</p>}
        {projects?.length === 0 && <p className="muted">{t.emptyWorkspace}</p>}
        <div className="project-grid">
          {projects?.map((p) => (
            <a key={p.slug} className="project-card" href={`#/p/${encodeURIComponent(p.slug)}`}>
              <img src={imageUrl(p.slug)} alt={p.name} loading="lazy" />
              <div className="project-meta">
                <b>{p.name}</b>
                <span className="muted">
                  {p.type}
                  {p.stage ? ` · ${t.stagePrefix} ${p.stage}` : ''} · {p.features} {t.featuresSuffix}
                </span>
                {(p.solveStatus || p.needsReview) && (
                  <span className="chips">
                    {p.solveStatus && <span className={`chip-tag solve-${p.solveStatus}`}>{p.solveStatus}</span>}
                    {p.needsReview ? (
                      <span className="chip-tag review">
                        {p.needsReview} {t.reviewSuffix}
                      </span>
                    ) : null}
                  </span>
                )}
              </div>
            </a>
          ))}
        </div>
      </section>

      {busy && (
        <div className="overlay">
          <div className="overlay-box">
            {t.overlayTitle}
            <p className="muted">{t.stageSolving}</p>
          </div>
        </div>
      )}
    </div>
  );
}
