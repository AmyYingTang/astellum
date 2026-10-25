import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { ColorKey, COLOR_PALETTE, canMagnify, type Reading } from '@astellum/schema';
import type { Action } from './state.js';
import { useUi } from './i18n.js';

interface Props {
  report: Reading;
  imageName: string;
  selectedId: string | null;
  dirty: boolean;
  dispatch: React.Dispatch<Action>;
  onSave: () => void;
  style?: React.CSSProperties;
}


export function Sidebar({
  report,
  imageName,
  selectedId,
  dirty,
  dispatch,
  onSave,
  style,
}: Props): React.JSX.Element {
  const { t, lang } = useUi();
  const obj = report.object;
  // Everything starts folded: the column is shared with the facts and the
  // generator now, and a frame that needs no edits should not make anyone
  // scroll past its text. A feature added later is not in the set, so it opens.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(report.features.map((f) => f.id)),
  );
  const [narrativeOpen, setNarrativeOpen] = useState(false);
  // Picking a mark on the picture opens its card — folded, it would be selected
  // with nothing there to edit.
  // Only on a change: the page opens with a mark already selected, and that
  // one should start folded like the rest.
  const lastSelected = useRef(selectedId);
  useEffect(() => {
    if (selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    if (!selectedId) return;
    setCollapsed((s) => {
      if (!s.has(selectedId)) return s;
      const n = new Set(s);
      n.delete(selectedId);
      return n;
    });
  }, [selectedId]);
  const toggleCollapse = (id: string): void =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allCollapsed = report.features.length > 0 && report.features.every((f) => collapsed.has(f.id));
  const toggleAll = (): void =>
    setCollapsed(allCollapsed ? new Set() : new Set(report.features.map((f) => f.id)));
  return (
    <aside className="sidebar" style={style}>
      <header className="sidebar-head">
        <div className="sidebar-title">
          <input
            className="title-input"
            value={obj.name[lang]}
            title={t.titleHint}
            onFocus={() => dispatch({ type: 'beginChange' })}
            onChange={(e) =>
              dispatch({ type: 'setObjectName', lang, value: e.target.value, commit: false })
            }
          />
          <p className="muted">
            {report.features.length} {t.featuresSuffix} · {imageName}
          </p>
        </div>
        <button className="save" onClick={onSave} disabled={!dirty}>
          {dirty ? t.save : t.saved}
        </button>
      </header>

      <section className="block">
        <div className="block-head">
          <button className="fold-head" onClick={() => setNarrativeOpen((v) => !v)}>
            <span className="collapse-toggle">{narrativeOpen ? '▾' : '▸'}</span>
            <span className="field-label">{t.narrative}</span>
          </button>
        </div>
        {narrativeOpen && (
          <textarea
            className="narrative"
            value={report.narrative[lang]}
            rows={5}
            onFocus={() => dispatch({ type: 'beginChange' })}
            onChange={(e) =>
              dispatch({ type: 'setNarrative', lang, value: e.target.value, commit: false })
            }
          />
        )}
      </section>

      <section className="block">
        <div className="block-head">
          <label className="field-label">
            {t.featuresLabel} ({report.features.length})
          </label>
          <div className="block-head-actions">
            {report.features.length > 1 && (
              <button className="link-btn" onClick={toggleAll}>
                {allCollapsed ? t.expandAll : t.collapseAll}
              </button>
            )}
            <button onClick={() => dispatch({ type: 'addFeature' })}>{t.add}</button>
          </div>
        </div>

        {report.features.map((f) => {
          const selected = f.id === selectedId;
          return (
            <div
              key={f.id}
              className={`feature-card${selected ? ' selected' : ''}${f.needs_human_review ? ' needs-review' : ''}`}
              onMouseDown={() => dispatch({ type: 'select', id: f.id })}
            >
              {f.needs_human_review && (
                <div className="review-banner" title={t.needsReviewTitle}>
                  <span>⚠ {t.reviewSuffix}</span>
                  <button onClick={() => dispatch({ type: 'confirmFeature', id: f.id })}>
                    {t.confirmReview}
                  </button>
                </div>
              )}
              <div className="feature-row">
                <button
                  className="collapse-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapse(f.id);
                  }}
                  aria-label={collapsed.has(f.id) ? 'expand' : 'collapse'}
                >
                  {collapsed.has(f.id) ? '▸' : '▾'}
                </button>
                <span className="badge-dot" style={{ background: COLOR_PALETTE[f.color_key].badge }}>
                  {f.badge.num}
                </span>
                <input
                  className="label-input"
                  value={f.label[lang]}
                  onFocus={() => dispatch({ type: 'beginChange' })}
                  onChange={(e) =>
                    dispatch({ type: 'setLabel', id: f.id, lang, value: e.target.value, commit: false })
                  }
                />
                <button
                  className="delete"
                  title={t.deleteFeature}
                  onClick={() => dispatch({ type: 'deleteFeature', id: f.id })}
                >
                  ✕
                </button>
              </div>

              {!collapsed.has(f.id) && (
                <>
                  <div className="feature-row">
                    <select
                      value={f.color_key}
                      onChange={(e) =>
                        dispatch({ type: 'setColor', id: f.id, color: e.target.value as ColorKey })
                      }
                    >
                      {ColorKey.options.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <input
                      className="num-input"
                      value={f.badge.num}
                      title={t.badgeNum}
                      onFocus={() => dispatch({ type: 'beginChange' })}
                      onChange={(e) =>
                        dispatch({ type: 'setBadgeNum', id: f.id, num: e.target.value, commit: false })
                      }
                    />
                    {/* Only a mark an inset could be for is asked about one —
                        the planner's own test, so a ring or a front already
                        big enough to read gets no switch that would do
                        nothing. Off frees the slot for the next mark down the
                        list; on puts this one back in the queue. */}
                    {canMagnify(f, report.image) && (
                      <button
                        type="button"
                        className={`magnify-toggle${f.callout?.off ? '' : ' on'}`}
                        aria-pressed={!f.callout?.off}
                        aria-label={t.calloutLabel}
                        title={`${t.calloutLabel} · ${f.callout?.off ? t.calloutOff : t.calloutOn}\n${t.calloutHint}`}
                        onClick={() =>
                          dispatch({ type: 'setCalloutOff', id: f.id, off: !f.callout?.off })
                        }
                      >
                        🔍
                      </button>
                    )}
                  </div>

                  <textarea
                    className="explanation"
                    value={[f.explanation[lang], f.physics?.[lang], f.interesting?.[lang]]
                      .filter(Boolean)
                      .join('\n\n')}
                    rows={7}
                    placeholder={t.phExplanation}
                    onFocus={() => dispatch({ type: 'beginChange' })}
                    onChange={(e) =>
                      dispatch({ type: 'setFeatureBody', id: f.id, lang, value: e.target.value, commit: false })
                    }
                  />
                </>
              )}
            </div>
          );
        })}
      </section>
    </aside>
  );
}
