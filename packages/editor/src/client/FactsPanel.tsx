import type * as React from 'react';
import { useState } from 'react';
import {
  COLOR_PALETTE,
  otypeLabel,
  formatRaHms,
  formatDecDms,
  type FactSheet,
  type Reading,
} from '@astellum/schema';
import { useUi } from './i18n.js';
import { writtenPassages } from './state.js';

export interface ReidentifyOptions {
  starMagMax?: number;
}

interface Props {
  reading: Reading;
  factsheet: FactSheet | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReidentify: (opts: ReidentifyOptions) => void;
  reidentifying: boolean;
  /** Further buttons for the action row, beside re-identify. */
  actions?: React.ReactNode;
}

type FactObject = FactSheet['objects'][number];

function objectDetail(o: FactObject, lang: 'zh' | 'en'): string {
  // type code/gloss · identity conf · type conf (+source) · coord · size · distance.
  const gloss = otypeLabel(o.type.otype);
  const code = o.type.otype ? (gloss ? `${o.type.otype} (${gloss[lang]})` : o.type.otype) : '';
  const typeConf =
    o.type_confidence != null
      ? `type ${o.type_confidence.toFixed(2)}${o.type.source === 'wiki' ? ' · wiki' : ''}`
      : undefined;
  const parts = [
    code,
    `id ${o.confidence.toFixed(2)}`,
    typeConf,
    `${formatRaHms(o.coord.ra_deg)} ${formatDecDms(o.coord.dec_deg)}`,
    o.size_arcmin ? `${o.size_arcmin[0]}′` : undefined,
    o.distance ? `${o.distance.value} ${o.distance.unit}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Catalogue designations beyond the one already shown as the label. */
function designationsLine(o: FactObject, label: string): string {
  return o.designations.filter((d) => d && d !== label).join(' / ');
}

/** Cross-ID separation, structured: a one-line summary + the per-match lines, so
 * a long list ("same object" catalogued under many numbers) can collapse. */
function separationInfo(
  o: FactObject,
  lang: 'zh' | 'en',
): { summary: string; verdict: string; items: string[] } | null {
  if (!o.cross_match?.length) return null;
  const me = o.designations[0] ?? o.names[0] ?? '';
  const thr = o.size_arcmin ? o.size_arcmin[0] : 5;
  const same = o.cross_match.every((m) => m.sep_arcmin <= thr);
  const verdict = same ? (lang === 'en' ? ' · same object' : ' · 同一天体') : '';
  const items = o.cross_match.map((m) => `${me} ↔ ${m.id} · Δ ${m.sep_arcmin}′`);
  const n = items.length;
  const head = lang === 'en' ? `${n} cross-ID${n > 1 ? 's' : ''}` : `${n} 个交叉证认`;
  return { summary: head + verdict, verdict, items };
}

/** Title type label: stars get the specific gloss (s*r → 红超巨星) since their
 * category label is just "Star"; nebulae/galaxies keep their clean category label. */
function typeName(o: FactObject, lang: 'zh' | 'en'): string {
  if (o.category === 'star') return otypeLabel(o.type.otype)?.[lang] ?? o.type[lang];
  return o.type[lang];
}

type RFeature = Reading['features'][number];

/** Detail line for a Class-B feature: anchor direction + parent + confidence,
 * resolved from the grounding fact object. */
function bFeatureDetail(f: RFeature, byId: Map<string, FactObject>, lang: 'zh' | 'en'): string {
  const o = f.fact_ref ? byId.get(f.fact_ref.object_id) : undefined;
  const parent = o?.parent_object_id ? byId.get(o.parent_object_id) : undefined;
  const parts = [
    o ? `conf ${o.confidence.toFixed(2)}` : undefined,
    o?.localization?.direction,
    parent ? `↳ ${parent.names[0] ?? parent.type[lang]}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * The facts half of the edit column: the full grounding fact sheet — solve geometry + a numbered legend
 * mapping each badge on the image to its object (color · number · name · type ·
 * RA/Dec · size · distance · catalog ids · confidence). Read-only; clicking a row
 * selects that annotation.
 */
export function FactsPanel({
  reading,
  factsheet,
  selectedId,
  onSelect,
  onReidentify,
  reidentifying,
  actions,
}: Props): React.JSX.Element {
  const { t, lang } = useUi();
  const objById = new Map((factsheet?.objects ?? []).map((o) => [o.id, o]));
  // A-class (catalog object) vs Class-B (inferred morphology) — split by the
  // factsheet tier, not the shape, so a B-feature drawn as a circle (a comet's
  // coma) still lands under morphological features, not catalog objects.
  const isB = (f: { id: string }): boolean => objById.get(f.id)?.tier === 'B';
  const aFeatures = reading.features.filter((f) => !isB(f));
  const bFeatures = reading.features.filter((f) => isB(f));
  const s = factsheet?.solve;
  const [reidOpen, setReidOpen] = useState(false);
  // Written text is the one thing a re-identification destroys that took
  // real time to make, so when there is some the warning says how much.
  const textCount = writtenPassages(reading);
  const [starMag, setStarMag] = useState(4);

  return (
    <div className="facts-panel">
      <div className="facts-head">
        {actions}
        <div className="reid">
          <button className="primary" onClick={() => setReidOpen((v) => !v)} disabled={reidentifying}>
            {reidentifying ? t.reidentifying : `${t.reidentify} ▾`}
          </button>
          {reidOpen && (
            <div className="reid-menu">
              {textCount > 0 && (
                <p className="reid-danger">⚠ {t.reidClearsText.replace('{n}', String(textCount))}</p>
              )}
              <p className="reid-warn">⚠ {t.reidentifyConfirm}</p>
              <label className="reid-param">
                <span>{t.starMagLabel}</span>
                <input
                  type="number"
                  step="0.5"
                  value={starMag}
                  onChange={(e) => setStarMag(Number(e.target.value))}
                />
              </label>
              <div className="reid-actions">
                <button onClick={() => setReidOpen(false)}>{t.reidCancel}</button>
                <button
                  className={textCount > 0 ? 'danger' : 'primary'}
                  onClick={() => {
                    setReidOpen(false);
                    onReidentify({ starMagMax: starMag });
                  }}
                >
                  {t.reidConfirmBtn}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {s ? (
        <div className="facts-solve muted">
          <div>
            {t.factsSolve}: <b>{s.status}</b> · frame={s.frame}
          </div>
          {s.ra_deg != null && s.dec_deg != null && (
            <div title={`RA ${s.ra_deg.toFixed(4)}° · Dec ${s.dec_deg.toFixed(4)}°`}>
              中心 / center: RA {formatRaHms(s.ra_deg)} · Dec {formatDecDms(s.dec_deg)}
            </div>
          )}
          <div>
            {s.pixscale_arcsec != null ? `${s.pixscale_arcsec.toFixed(2)}″/px` : ''}
            {s.radius_deg != null ? ` · r=${s.radius_deg.toFixed(2)}°` : ''}
            {s.orientation_deg != null ? ` · orient ${s.orientation_deg.toFixed(1)}°` : ''}
          </div>
          {s.nova_job_id && <div>nova job {s.nova_job_id}</div>}
        </div>
      ) : (
        <p className="muted">{t.factsNoneYet}</p>
      )}

      {factsheet?.warnings.map((w, i) => (
        <p key={i} className="facts-warn">
          ⚠ {w}
        </p>
      ))}

      <h3>
        {t.factsObjects} ({aFeatures.length})
      </h3>
      <ul className="legend">
        {aFeatures.map((f) => {
          const o = f.fact_ref ? objById.get(f.fact_ref.object_id) : undefined;
          return (
            <li
              key={f.id}
              className={`legend-row${selectedId === f.id ? ' sel' : ''}`}
              onClick={() => onSelect(f.id)}
            >
              <span className="legend-dot" style={{ background: COLOR_PALETTE[f.color_key].badge }}>
                {f.badge.num}
              </span>
              <span className="legend-text">
                <span className="legend-name">
                  {f.label[lang]}
                  {o && typeName(o, lang) !== f.label[lang] ? ` — ${typeName(o, lang)}` : ''}
                  {o?.type_needs_review ? ' ⚠机制待核' : ''}
                  {f.needs_human_review ? ' ⚠' : ''}
                </span>
                {o && designationsLine(o, f.label[lang]) && (
                  <span className="muted">{designationsLine(o, f.label[lang])}</span>
                )}
                {o && (
                  <span
                    className="muted"
                    title={`RA ${o.coord.ra_deg.toFixed(4)}° Dec ${o.coord.dec_deg.toFixed(4)}°`}
                  >
                    {objectDetail(o, lang)}
                  </span>
                )}
                {(() => {
                  const sep = o && separationInfo(o, lang);
                  if (!sep) return null;
                  // Short lists stay inline; a long "same object" list collapses.
                  if (sep.items.length <= 2) {
                    return (
                      <span className="muted">
                        {sep.items.join('; ')}
                        {sep.verdict}
                      </span>
                    );
                  }
                  return (
                    <details
                      className="muted xmatch"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <summary>{sep.summary}</summary>
                      {sep.items.map((x, i) => (
                        <div key={i}>{x}</div>
                      ))}
                    </details>
                  );
                })()}
              </span>
            </li>
          );
        })}
      </ul>

      {bFeatures.length > 0 && (
        <>
          <h3>
            {t.factsFeaturesB} ({bFeatures.length})
          </h3>
          {(['atlas', 'cv', 'geometric', 'ai'] as const).map((src) => {
            const rows = bFeatures.filter(
              (f) => (objById.get(f.id)?.detection_source ?? 'geometric') === src,
            );
            if (!rows.length) return null;
            const srcLabel =
              src === 'cv'
                ? t.factsBSourceCv
                : src === 'ai'
                  ? t.factsBSourceAi
                  : src === 'atlas'
                    ? t.factsBSourceAtlas
                    : t.factsBSourceGeometric;
            return (
              <div key={src} className="b-source-group">
                <p className="b-source-head muted">── {srcLabel} ──</p>
                <ul className="legend">
                  {rows.map((f) => (
                    <li
                      key={f.id}
                      className={`legend-row b-feature${selectedId === f.id ? ' sel' : ''}`}
                      onClick={() => onSelect(f.id)}
                    >
                      <span
                        className="legend-dot"
                        style={{ background: COLOR_PALETTE[f.color_key].badge }}
                      >
                        {f.badge.num}
                      </span>
                      <span className="legend-text">
                        <span className="legend-name">
                          {f.label[lang]}
                          {f.needs_human_review ? ' ⚠' : ''}
                        </span>
                        <span className="muted">{bFeatureDetail(f, objById, lang)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
