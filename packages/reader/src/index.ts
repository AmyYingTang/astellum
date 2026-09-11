import { Reading, categoryColorKey, featureColorKey, otypeLabel } from '@astellum/schema';
import type {
  FactSheet,
  FactObject,
  LocalizedString,
  PredefinedLibrary,
  ReadingFallback,
} from '@astellum/schema';
import { resolvePredefinedText, type PredefinedResult } from './predefinedText.js';
import { buildTailorPrompt } from './prompt.js';
import { runClaude, type RunClaudeOptions } from './claudeCli.js';
import { parseTailoring, type LlmTailoring } from './parseJson.js';

export { buildTailorPrompt } from './prompt.js';
export { runClaude } from './claudeCli.js';
export { parseTailoring, extractJson, LlmTailoring } from './parseJson.js';
export { lookupSimbad, parseSimbadAscii, type SimbadFacts } from './simbad.js';
export {
  buildDraftPrompt,
  draftPredefinedStyle,
  draftToEntry,
  draftWordCount,
  type DraftOptions,
} from './draft.js';
export {
  resolvePredefinedText,
  coverageSummary,
  loadReadingLibrary,
  loadReadingLibraries,
  defaultReadingsPath,
  userReadingsPath,
  defaultReadingsPaths,
  ALL_FALLBACKS,
  type PredefinedResult,
  type PredefinedText,
  type PredefinedOptions,
} from './predefinedText.js';

export class ReaderError extends Error {
  /** Raw claude output, attached when parsing failed, for debugging. */
  readonly raw?: string;
  constructor(message: string, raw?: string) {
    super(message);
    this.name = 'ReaderError';
    this.raw = raw;
  }
}

export interface GenerateReadingOptions {
  toolVersion: string;
  tone?: string;
  model?: string;
  displayLanguage?: 'zh' | 'en';
  imagePath?: string;
  imageSrc?: string;
  runner?: (opts: RunClaudeOptions) => Promise<string>;
}

const PC_TO_LY = 3.26156;
const UNIT_TO_LY: Record<string, number> = {
  pc: PC_TO_LY,
  kpc: PC_TO_LY * 1000,
  Mpc: PC_TO_LY * 1_000_000,
  ly: 1,
};

function distanceToLy(d?: { value: number; unit: string }): number | undefined {
  if (!d) return undefined;
  const k = UNIT_TO_LY[d.unit];
  return k ? Math.round(d.value * k) : undefined;
}

/** Survey designations that aren't human-friendly labels. */
const JUNK_NAME = /^(\[|2MASX\b|LEDA\b|PGCC\b|TGU\b|GSC\b|UCAC|Gaia |TYC |HD |HIP |SAO |\* )/;

/** Pick a display label: common name → proper name → designation → type. */
function displayLabel(obj: FactObject): LocalizedString {
  // 0. the common name wins (Pencil Nebula / 铅笔星云) — the whole point of the
  //    cross-ID work. en from SIMBAD NAME, zh from Wikidata (may be one-sided).
  const cn = obj.common_name;
  if (cn && (cn.en || cn.zh)) {
    return { zh: cn.zh ?? cn.en!, en: cn.en ?? cn.zh! };
  }
  // 1. a friendly proper name (Antares, Sh 2-308 …)
  const n = obj.names[0] ?? '';
  if (n && !JUNK_NAME.test(n)) return { zh: n, en: n };
  // 2. a canonical catalogue designation
  const id =
    (obj.designations ?? [])[0] ??
    obj.catalog_ids.messier ??
    obj.catalog_ids.ngc ??
    obj.catalog_ids.ic;
  if (id) return { zh: id, en: id };
  // 3. a star's designation still says *which* star (HD 50896, alf Sco) — better
  //    than a bare type; drop SIMBAD's leading "* " and collapse double spaces.
  if (obj.category === 'star' && n) {
    const desig = n.replace(/^\*\s+/, '').replace(/\s+/g, ' ').trim();
    if (desig) return { zh: desig, en: desig };
  }
  // 4. last resort: the specific type gloss for stars, else the category label
  const gloss = obj.category === 'star' ? otypeLabel(obj.type.otype) : null;
  return gloss ?? { zh: obj.type.zh, en: obj.type.en };
}

interface TailoredText {
  explanation: LocalizedString;
  physics?: LocalizedString;
  interesting?: LocalizedString;
}

interface BuildOptions {
  toolVersion: string;
  tone?: string;
  displayLanguage?: 'zh' | 'en';
  imageSrc?: string;
  llm: string;
  /** Sense-of-scale / cultural / fun-fact lines from a predefined entry. */
  extraFacts?: LocalizedString[];
}

const BADGE_ANCHOR = 0.7071;

interface Spreadable {
  circle: { cx: number; cy: number; r: number };
  badge: { offset_x: number; offset_y: number; bubble_r: number };
  /** Curator-placed label position (display px), from an atlas label_anchor.
   *  Pinned: seeded here and never pushed by the spread. */
  label_pixel?: [number, number];
}

/** Push overlapping badge anchors apart (so labels don't pile up), writing the
 * delta into each badge's offset. The badge anchor mirrors the renderer's.
 * A badge with an explicit label_pixel is pinned — a human put it there. */
function spreadBadges(features: Spreadable[], width: number, height: number): void {
  const pts = features.map((f) => {
    const ax = f.circle.cx + (f.circle.r + f.badge.bubble_r) * BADGE_ANCHOR;
    const ay = f.circle.cy - (f.circle.r + f.badge.bubble_r) * BADGE_ANCHOR;
    const pinned = !!f.label_pixel;
    return {
      x: pinned ? f.label_pixel![0] : ax,
      y: pinned ? f.label_pixel![1] : ay,
      r: f.badge.bubble_r,
      ax,
      ay,
      pinned,
    };
  });
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        if (a.pinned && b.pinned) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const min = (a.r + b.r) * 1.35;
        if (d < min) {
          if (d < 1) {
            dx = Math.cos(i + j);
            dy = Math.sin(i + j);
            d = 1;
          }
          // A pinned badge stays put; the other one absorbs the whole push.
          const push = a.pinned || b.pinned ? min - d : (min - d) / 2;
          if (!a.pinned) {
            a.x -= (dx / d) * push;
            a.y -= (dy / d) * push;
          }
          if (!b.pinned) {
            b.x += (dx / d) * push;
            b.y += (dy / d) * push;
          }
        }
      }
    }
    // Keep every iteration inside the frame. Clamping only at the end let badges
    // pushed toward the same corner both land on the same edge coordinate and
    // overlap again; clamping here means the next pass sees the collision and
    // slides them apart along the edge instead of stacking them.
    for (const p of pts) {
      if (p.pinned) continue;
      p.x = Math.max(p.r, Math.min(width - p.r, p.x));
      p.y = Math.max(p.r, Math.min(height - p.r, p.y));
    }
  }
  features.forEach((f, i) => {
    const p = pts[i]!;
    f.badge.offset_x = Math.round(p.x - p.ax);
    f.badge.offset_y = Math.round(p.y - p.ay);
  });
}

/**
 * Deterministic factsheet → Reading. Each catalogued object becomes one
 * annotation: a circle sized by its angular diameter (stars get a small fixed
 * marker), placed by its grounded pixel, colored by category, labeled by a
 * friendly name. Explanatory text comes from `byId`/`narrative` (LLM, or empty
 * for a facts-only stub).
 */
function buildReading(
  factsheet: FactSheet,
  narrative: LocalizedString,
  byId: Map<string, TailoredText>,
  opts: BuildOptions,
): Reading {
  const { width, height } = factsheet.image;
  const pixscale = factsheet.solve.pixscale_arcsec; // arcsec/px
  const bubbleR = Math.max(24, Math.round(Math.min(width, height) / 40));
  const starR = Math.max(20, Math.round(Math.min(width, height) / 60));

  const maxR = Math.min(width, height) * 0.2; // a circle shouldn't dominate the frame
  const radiusFor = (obj: FactObject): number => {
    if (obj.size_arcmin && pixscale) {
      const r = (obj.size_arcmin[0] * 60) / pixscale / 2; // arcmin → arcsec → px → radius
      return Math.max(starR, Math.min(maxR, Math.round(r)));
    }
    return starR;
  };

  // A-class objects → solid circles. Class-B: a *shell* is marked with a small
  // dashed sample circle placed on a point of its rim (not a ring around the
  // whole thing); a *front* is a direction arrow toward the A anchor.
  const maxArrow = Math.min(width, height) * 0.15;
  const sampleR = Math.max(starR, Math.round(Math.min(width, height) / 30));
  const byObjId = new Map(factsheet.objects.map((o) => [o.id, o]));
  const aObjects = factsheet.objects.filter((o) => o.tier !== 'B');
  const primary = aObjects[0]!;

  // The comet head is a title-only container — its parts (coma/nucleus/tails)
  // carry everything, so drop it from the drawn + numbered + listed features
  // ("彗星" is still the title via `primary`).
  const isCometHead = (o: FactObject): boolean => o.category === 'comet' && o.tier !== 'B';
  const drawnObjects = factsheet.objects.filter((o) => !isCometHead(o));

  const features = drawnObjects.map((obj, i) => {
    const t = byId.get(obj.id);
    const base = obj.coord.pixel ?? [Math.round(width / 2), Math.round(height / 2)];
    const isB = obj.tier === 'B';
    // A geometric front points an arrow at its anchor star; a wind shell is a
    // small dashed sample circle; a CV-detected ionization front is a curved arc
    // along the nebula's rim (so it reads as a *front*, not a blob), drawn inside
    // the parent's circle so it doesn't sit on top of it.
    const isCv = obj.detection_source === 'cv';
    let cx = base[0]!;
    let cy = base[1]!;
    const parentPix =
      isB && obj.parent_object_id ? byObjId.get(obj.parent_object_id)?.coord.pixel : null;
    let shape: 'circle' | 'shell' | 'arrow' | 'arc' | 'dot' | 'polygon' | 'polyline' = !isB
      ? 'circle'
      : obj.feature_type === 'comet_coma' // the coma is a full circle, like an object
        ? 'circle'
        : obj.feature_type === 'comet_nucleus' // a point marker; badge clears the coma
          ? 'dot'
          : obj.feature_type === 'pillar' // a morphology outline → soft closed polygon
            ? 'polygon'
            : obj.feature_type === 'ionization_front' && obj.polygon // a pillar's rim → thin line
              ? 'polyline'
              : obj.arrow_to // a directional feature (comet tail) → arrow
                ? 'arrow'
                : obj.feature_type === 'ionization_front' && isCv
                  ? 'arc'
                  : obj.feature_type === 'bubble_shell'
                    ? 'shell'
                    : isCv
                      ? 'shell'
                      : 'arrow';
    // AI-suggested features are coarse points → a soft dashed-circle marker.
    if (isB && obj.detection_source === 'ai') shape = 'shell';
    // Atlas features carry an explicit geometry (polygon/polyline/point) — honour
    // it directly, overriding the feature_type→shape heuristic above.
    if (obj.geometry_kind) shape = obj.geometry_kind === 'point' ? 'dot' : obj.geometry_kind;
    // A shell is a small sample circle; its coord.pixel was already snapped onto
    // the (bright) rim in Stage 1, so just draw a small circle there.
    let r = shape === 'shell' || shape === 'arc' ? sampleR : radiusFor(obj);
    // The nucleus is a small dot, but anchor its badge at the coma radius (the
    // parent's size) so the label sits outside the coma instead of over it.
    if (shape === 'dot') {
      const parent = obj.parent_object_id ? byObjId.get(obj.parent_object_id) : undefined;
      r = parent ? radiusFor(parent) : sampleR;
    }
    let arrow_to: [number, number] | undefined;
    let arc: { cx: number; cy: number; r: number; a0: number; a1: number } | undefined;
    let polygon: [number, number][] | undefined;
    if (shape === 'polygon') {
      // Draw the contour; use arrow_to (a sky→pixel point) as the 迎光 arrow.
      polygon = obj.polygon;
      if (obj.arrow_to?.pixel) arrow_to = obj.arrow_to.pixel;
      if (polygon && polygon.length >= 2) {
        // Anchor the badge hugging the shape's top edge (a small radius off its
        // topmost vertex), not out at centroid+extent — that floated the badge
        // far from large/elongated outlines. Still draggable.
        [cx, cy] = polygon.reduce((a, p) => (p[1] < a[1] ? p : a), polygon[0]);
        r = starR;
      } else {
        shape = 'shell'; // no contour → fall back to a marker
        r = starR;
      }
    }
    if (shape === 'polyline') {
      // A thin open line through its points; badge hugs the top of the segment.
      polygon = obj.polygon;
      if (polygon && polygon.length >= 2) {
        [cx, cy] = polygon.reduce((a, p) => (p[1] < a[1] ? p : a), polygon[0]);
        r = starR;
      } else {
        shape = 'shell';
        r = starR;
      }
    }
    if (shape === 'arc') {
      // Curve centred on the parent nebula, through the detected rim point. Since
      // the rim sits inside the (large) nebula circle, the arc lands inside it.
      if (parentPix) {
        const dx = cx - parentPix[0];
        const dy = cy - parentPix[1];
        const rr = Math.hypot(dx, dy) || 1;
        const theta = Math.atan2(dy, dx);
        const half = 0.5; // ~29° each side → ~57° arc
        arc = { cx: parentPix[0], cy: parentPix[1], r: Math.round(rr), a0: theta - half, a1: theta + half };
      } else {
        shape = 'shell'; // no parent to curve around → fall back to a marker
      }
    }
    if (shape === 'arrow') {
      r = starR;
      if (obj.arrow_to?.pixel) {
        const tip = obj.arrow_to.pixel;
        // A comet tail: don't run the line along the whole tail — drop a short
        // arrow perpendicular to it, pointing AT the tail from the side.
        const dx = tip[0] - cx;
        const dy = tip[1] - cy;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L;
        const uy = dy / L;
        const px = cx + ux * L * 0.45; // a point partway along the tail
        const py = cy + uy * L * 0.45;
        let nx = -uy; // perpendicular to the tail
        let ny = ux;
        if ((width / 2 - px) * nx + (height / 2 - py) * ny < 0) {
          nx = -nx; // come in from the frame-interior side
          ny = -ny;
        }
        const arm = Math.min(Math.max(L * 0.16, 50), 160);
        cx = Math.round(px + nx * arm);
        cy = Math.round(py + ny * arm);
        arrow_to = [Math.round(px), Math.round(py)];
      }
      const ap = obj.localization?.anchor_ref
        ? byObjId.get(obj.localization.anchor_ref)?.coord.pixel
        : null;
      if (!arrow_to && ap) {
        const dx = ap[0] - cx;
        const dy = ap[1] - cy;
        const d = Math.hypot(dx, dy) || 1;
        const len = Math.min(d, maxArrow);
        arrow_to = [Math.round(cx + (dx / d) * len), Math.round(cy + (dy / d) * len)];
      }
    }
    return {
      id: obj.id,
      fact_ref: { object_id: obj.id, feature_id: obj.id },
      label: isB ? { zh: obj.type.zh, en: obj.type.en } : displayLabel(obj),
      color_key:
        obj.detection_source === 'atlas' && obj.feature_type
          ? featureColorKey(obj.feature_type) // atlas: the feature's own palette (not forced cyan)
          : shape === 'polyline' // a pillar's bright rim — cyan, high-contrast vs the red Hα body
            ? 'shock'
            : obj.feature_type
              ? featureColorKey(obj.feature_type)
              : categoryColorKey(obj.category),
      circle: { cx, cy, r },
      shape,
      // The comet head is a container — its parts (coma/nucleus/tails) carry the
      // visuals, so don't draw a duplicate circle for the head itself.
      ...(obj.category === 'comet' && !isB ? { draw: false } : {}),
      ...(arrow_to ? { arrow_to } : {}),
      ...(arc ? { arc } : {}),
      ...(polygon ? { polygon } : {}),
      // Carried only through spreadBadges (which pins it), not into the Reading.
      ...(obj.label_pixel ? { label_pixel: obj.label_pixel } : {}),
      badge: { num: String(i + 1), offset_x: 0, offset_y: 0, bubble_r: bubbleR },
      explanation: t?.explanation ?? { zh: '', en: '' },
      physics: t?.physics,
      interesting: t?.interesting,
      needs_human_review: isB ? obj.needs_human_review : obj.coord.pixel == null,
    };
  });

  // Spread badges so they don't pile up when objects cluster near frame centre.
  // Each badge starts just outside its circle (up-right); push overlapping ones
  // apart, then store the delta as the badge offset (the user can still nudge).
  spreadBadges(features, width, height);

  return Reading.parse({
    version: '2.0',
    source_factsheet: { hash: factsheet.image.hash },
    image: { src: opts.imageSrc ?? factsheet.image.src, width, height },
    display_language: opts.displayLanguage ?? 'zh',
    tone: opts.tone,
    object: {
      name: displayLabel(primary),
      aliases: primary.names.slice(1),
      type: { zh: primary.type.zh, en: primary.type.en },
      distance_ly: distanceToLy(primary.distance),
      size_arcmin: primary.size_arcmin?.[0],
    },
    narrative,
    features,
    extra_facts: opts.extraFacts ?? [],
    created_at: new Date().toISOString(),
    generator: { tool: 'astellum', tool_version: opts.toolVersion, llm: opts.llm },
  });
}

/**
 * Facts-only stub: a Reading built straight from the FactSheet with NO LLM —
 * grounded circles/colors/labels but empty explanations. Lets the studio show
 * the identification result (placement + Facts panel) without calling claude.
 */
export function readingFromFactsheet(
  factsheet: FactSheet,
  opts: { toolVersion: string; displayLanguage?: 'zh' | 'en'; imageSrc?: string },
): Reading {
  if (!factsheet.objects.some((o) => o.tier !== 'B')) {
    throw new ReaderError(
      `FactSheet has no grounded objects (solve=${factsheet.solve.status}); nothing to show.`,
    );
  }
  return buildReading(factsheet, { zh: '', en: '' }, new Map(), {
    toolVersion: opts.toolVersion,
    displayLanguage: opts.displayLanguage,
    imageSrc: opts.imageSrc,
    llm: 'none (facts-only)',
  });
}

/**
 * Stage 2 with NO LLM: assemble a Reading whose text comes from the curated
 * predefined library, falling through target text → the annotation's note →
 * the type-level generic note → a facts template. This is the onsite path —
 * offline, deterministic, and fast enough to run in front of an audience.
 *
 * Returns the coverage alongside the Reading so the operator UI can say which
 * annotations got bespoke text and which got a generic note.
 */
export function readingFromPredefined(
  factsheet: FactSheet,
  library: PredefinedLibrary | null,
  opts: {
    toolVersion: string;
    displayLanguage?: 'zh' | 'en';
    imageSrc?: string;
    style?: string;
    fallback?: ReadingFallback[];
  },
): { reading: Reading; coverage: PredefinedResult } {
  if (!factsheet.objects.some((o) => o.tier !== 'B')) {
    throw new ReaderError(
      `FactSheet has no grounded objects (solve=${factsheet.solve.status}); nothing to show.`,
    );
  }
  const coverage = resolvePredefinedText(factsheet, library, {
    style: opts.style,
    fallback: opts.fallback,
  });
  const reading = buildReading(factsheet, coverage.narrative, coverage.byId, {
    toolVersion: opts.toolVersion,
    displayLanguage: opts.displayLanguage,
    imageSrc: opts.imageSrc,
    extraFacts: coverage.extraFacts,
    llm: `none (predefined${coverage.style ? `:${coverage.style}` : ''})`,
  });
  return { reading, coverage };
}

/** Run the LLM and parse its JSON, retrying with the parse error fed back (up to 3 attempts). */
async function runTailoring(
  runner: (o: RunClaudeOptions) => Promise<string>,
  basePrompt: string,
  model: string | undefined,
): Promise<{ data?: LlmTailoring; raw: string; error: string }> {
  let raw = '';
  let error = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\n上一次输出无法解析为合法 JSON,错误:\n${error}\n请只输出修正后的、严格合法的 JSON(转义字符串内的引号与换行,不要任何多余文字)。`;
    raw = await runner({ prompt, model });
    const parsed = parseTailoring(raw);
    if (parsed.ok) return { data: parsed.data, raw, error: '' };
    error = parsed.error;
  }
  return { raw, error };
}

/**
 * Stage 2 on an EXISTING reading: ask the LLM to write bilingual explanatory
 * text for the annotations that are already there (preserving the human-reviewed
 * circles, labels and colors). Used by the editor's "generate reading" action.
 */
export async function tailorReading(
  reading: Reading,
  opts: {
    model?: string;
    imagePath?: string;
    tone?: string;
    /** Source fact sheet, when available — lets the prompt carry each feature's
     *  precise taxonomy type so the model writes about that structure, not the
     *  broad category. */
    factsheet?: FactSheet;
    runner?: (o: RunClaudeOptions) => Promise<string>;
  },
): Promise<Reading> {
  if (reading.features.length === 0) {
    throw new ReaderError('Reading has no annotations to explain.');
  }
  const runner = opts.runner ?? runClaude;
  const prompt = buildTailorPrompt({
    headline: `${reading.object.name.zh} / ${reading.object.name.en}`,
    items: reading.features.map((f) => {
      // The reading has no taxonomy key of its own; recover it from the fact
      // sheet entry it was grounded on, when one is supplied.
      const ft = opts.factsheet?.objects.find((o) => o.id === f.fact_ref?.object_id)?.feature_type;
      return {
        id: f.id,
        name: `${f.label.zh} / ${f.label.en}`,
        type: f.color_key,
        ...(ft ? { featureType: ft } : {}),
      };
    }),
    imagePath: opts.imagePath,
    tone: opts.tone,
  });

  const { data, raw, error } = await runTailoring(runner, prompt, opts.model);
  if (!data) {
    throw new ReaderError(`Failed to parse tailoring after retries: ${error}`, raw);
  }

  const byId = new Map(data.features.map((f) => [f.id, f]));
  return Reading.parse({
    ...reading,
    tone: opts.tone ?? reading.tone,
    narrative: data.narrative,
    features: reading.features.map((f) => {
      const t = byId.get(f.id);
      return {
        ...f,
        explanation: t?.explanation ?? f.explanation,
        physics: t?.physics ?? f.physics,
        interesting: t?.interesting ?? f.interesting,
      };
    }),
    edited_at: new Date().toISOString(),
  });
}

/**
 * Stage 2: consume a grounded FactSheet, ask the LLM to tailor bilingual
 * explanatory text onto its objects, and assemble a Reading. The LLM never
 * supplies identity, geometry or color — only the explanatory prose.
 */
export async function generateReading(
  factsheet: FactSheet,
  opts: GenerateReadingOptions,
): Promise<Reading> {
  // Only A-class objects are tailored/rendered for now; Class-B features are
  // surfaced in the Facts panel but not yet explained or drawn.
  const aObjects = factsheet.objects.filter((o) => o.tier !== 'B');
  const primary = aObjects[0];
  if (!primary) {
    throw new ReaderError(
      `FactSheet has no grounded objects (solve=${factsheet.solve.status}); nothing to tailor.`,
    );
  }

  const runner = opts.runner ?? runClaude;
  const prompt = buildTailorPrompt({
    headline: displayLabel(primary).zh,
    items: aObjects.map((obj) => {
      const l = displayLabel(obj);
      return {
        id: obj.id,
        name: `${l.zh} / ${l.en}`,
        type: obj.type.en,
        ...(obj.feature_type ? { featureType: obj.feature_type } : {}),
      };
    }),
    imagePath: opts.imagePath,
    tone: opts.tone,
  });

  const { data, raw, error } = await runTailoring(runner, prompt, opts.model);
  if (!data) {
    throw new ReaderError(`Failed to parse tailoring after retries: ${error}`, raw);
  }

  const byId = new Map<string, TailoredText>(data.features.map((f) => [f.id, f]));
  return buildReading(factsheet, data.narrative, byId, {
    toolVersion: opts.toolVersion,
    tone: opts.tone,
    displayLanguage: opts.displayLanguage,
    imageSrc: opts.imageSrc,
    llm: opts.model ?? 'claude',
  });
}
