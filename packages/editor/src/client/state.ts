import type { Circle, ColorKey, Feature, Reading } from '@astellum/schema';

/**
 * How many passages of written text a reading carries — the narrative and
 * each feature's explanation. The thing that takes real time to make, and so
 * what every overwrite warning counts.
 */
export function writtenPassages(r: Reading): number {
  return (
    (r.narrative.zh || r.narrative.en ? 1 : 0) +
    r.features.filter((f) => f.explanation.zh || f.explanation.en).length
  );
}

export interface EditorState {
  report: Reading;
  selectedId: string | null;
  past: Reading[];
  future: Reading[];
  dirty: boolean;
}

type Lang = 'zh' | 'en';

export type Action =
  | { type: 'select'; id: string | null }
  | { type: 'beginChange' } // snapshot current report for undo, before transient edits
  | { type: 'setCircle'; id: string; circle: Circle; commit?: boolean }
  | { type: 'setBadgeOffset'; id: string; offset_x: number; offset_y: number; commit?: boolean }
  | { type: 'setCalloutPos'; id: string; x: number; y: number; commit?: boolean }
  | { type: 'setCalloutOff'; id: string; off: boolean }
  | { type: 'nudge'; id: string; dx: number; dy: number }
  | { type: 'setLabel'; id: string; lang: Lang; value: string; commit?: boolean }
  | { type: 'setFeatureBody'; id: string; lang: Lang; value: string; commit?: boolean }
  | { type: 'setColor'; id: string; color: ColorKey }
  | { type: 'setBadgeNum'; id: string; num: string; commit?: boolean }
  | { type: 'confirmFeature'; id: string }
  | { type: 'setObjectName'; lang: Lang; value: string; commit?: boolean }
  | { type: 'setNarrative'; lang: Lang; value: string; commit?: boolean }
  | { type: 'addFeature' }
  | { type: 'deleteFeature'; id: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'markSaved' }
  /** A reading rewritten on the server (generated, re-read, re-identified):
   *  start over from it. Its undo history belongs to text that is gone. */
  | { type: 'replace'; report: Reading };

// Nothing selected on arrival: the page opens on a frame ready to export, and
// a highlighted mark would be one more thing that looks like it needs doing.
export function initState(report: Reading): EditorState {
  return { report, selectedId: null, past: [], future: [], dirty: false };
}

function mapFeature(report: Reading, id: string, fn: (f: Feature) => Feature): Reading {
  return { ...report, features: report.features.map((f) => (f.id === id ? fn(f) : f)) };
}

/** Apply a report mutation; when commit, snapshot the previous report for undo. */
function change(state: EditorState, next: Reading, commit: boolean): EditorState {
  return {
    ...state,
    report: next,
    past: commit ? [...state.past, state.report] : state.past,
    future: commit ? [] : state.future,
    dirty: true,
  };
}

function nextFeatureId(report: Reading): string {
  let n = report.features.length + 1;
  const ids = new Set(report.features.map((f) => f.id));
  while (ids.has(`f${n}`)) n += 1;
  return `f${n}`;
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedId: action.id };

    case 'beginChange':
      return { ...state, past: [...state.past, state.report], future: [] };

    case 'setCircle':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({ ...f, circle: action.circle })),
        action.commit ?? true,
      );

    case 'setBadgeOffset':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          badge: { ...f.badge, offset_x: action.offset_x, offset_y: action.offset_y },
        })),
        action.commit ?? true,
      );

    // Pinning a panel where somebody dragged it. Absolute, not an offset from
    // where the planner put it: that origin moves whenever anything else on
    // the frame moves, and a panel measured from a moving origin wanders after
    // it has been placed.
    case 'setCalloutPos':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          callout: { ...f.callout, x: action.x, y: action.y },
        })),
        action.commit ?? true,
      );

    // Refusing a panel, reversibly — which is why it is a flag and not a
    // deletion. Turning one off frees its place, so the next candidate down
    // may take it; turning it back on puts this one back in the queue.
    case 'setCalloutOff':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          callout: { ...f.callout, off: action.off },
        })),
        true,
      );

    case 'nudge':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          circle: { ...f.circle, cx: f.circle.cx + action.dx, cy: f.circle.cy + action.dy },
        })),
        true,
      );

    case 'setLabel':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          label: { ...f.label, [action.lang]: action.value },
        })),
        action.commit ?? true,
      );

    case 'setFeatureBody':
      // The editor edits one body field per language; physics/interesting are
      // folded into explanation on edit (cleared for both languages).
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          explanation: { ...f.explanation, [action.lang]: action.value },
          physics: undefined,
          interesting: undefined,
        })),
        action.commit ?? true,
      );

    case 'setColor':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({ ...f, color_key: action.color })),
        true,
      );

    case 'setBadgeNum':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({
          ...f,
          badge: { ...f.badge, num: action.num },
        })),
        action.commit ?? true,
      );

    case 'confirmFeature':
      return change(
        state,
        mapFeature(state.report, action.id, (f) => ({ ...f, needs_human_review: false })),
        true,
      );

    case 'setObjectName':
      return change(
        state,
        {
          ...state.report,
          object: {
            ...state.report.object,
            name: { ...state.report.object.name, [action.lang]: action.value },
          },
        },
        action.commit ?? true,
      );

    case 'setNarrative':
      return change(
        state,
        { ...state.report, narrative: { ...state.report.narrative, [action.lang]: action.value } },
        action.commit ?? true,
      );

    case 'addFeature': {
      const { width, height } = state.report.image;
      const id = nextFeatureId(state.report);
      const feature: Feature = {
        id,
        fact_ref: null,
        label: { zh: '新标注', en: 'New label' },
        color_key: 'star',
        shape: 'circle',
        draw: true,
        circle: { cx: Math.round(width / 2), cy: Math.round(height / 2), r: Math.round(Math.min(width, height) / 8) },
        badge: { num: String(state.report.features.length + 1), offset_x: 0, offset_y: 0, bubble_r: 30 },
        explanation: { zh: '', en: '' },
        needs_human_review: false,
      };
      return {
        ...change(state, { ...state.report, features: [...state.report.features, feature] }, true),
        selectedId: id,
      };
    }

    case 'deleteFeature': {
      const next = {
        ...state.report,
        features: state.report.features.filter((f) => f.id !== action.id),
      };
      const sel = state.selectedId === action.id ? (next.features[0]?.id ?? null) : state.selectedId;
      return { ...change(state, next, true), selectedId: sel };
    }

    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        report: prev,
        past: state.past.slice(0, -1),
        future: [state.report, ...state.future],
        dirty: true,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        report: next,
        past: [...state.past, state.report],
        future: state.future.slice(1),
        dirty: true,
      };
    }

    case 'markSaved':
      return { ...state, dirty: false };

    case 'replace':
      return initState(action.report);

    default:
      return state;
  }
}
