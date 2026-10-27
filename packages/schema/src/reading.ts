import { z } from 'zod';
import { ColorKey } from './colorKeys.js';
import { LocalizedString } from './i18n.js';

/**
 * The presentation layer (Stage 2 output) — LLM-generated + human-tuned
 * annotations, explanations and poster copy. Grounded facts live separately in
 * the FactSheet (factsheet.ts); this layer references them and is bilingual.
 */

export const Circle = z.object({
  cx: z.number(),
  cy: z.number(),
  r: z.number(),
});
export type Circle = z.infer<typeof Circle>;

export const Badge = z.object({
  num: z.string(), // "1", "2", "①" etc
  offset_x: z.number().default(0),
  offset_y: z.number().default(0),
  bubble_r: z.number().default(30),
});
export type Badge = z.infer<typeof Badge>;

export const Feature = z.object({
  id: z.string(), // stable id, used for editor sync
  /** Link back to the FactSheet object+feature this was grounded on; null when human-added. */
  fact_ref: z.object({ object_id: z.string(), feature_id: z.string() }).nullable().default(null),
  label: LocalizedString, // short name, bilingual
  color_key: ColorKey,
  circle: Circle,
  /**
   * How to draw it. 'circle' = solid ring (A-class catalog object); 'shell' =
   * dashed ring (a wind/PN shell, soft); 'arrow' = an anchored direction from
   * circle.{cx,cy} toward `arrow_to`; 'arc' = a curved segment along a nebula's
   * rim (e.g. an ionization front), defined by `arc`. All but 'circle' are
   * Class-B (inferred) annotations.
   */
  // 'dot' = a small fixed marker (a comet nucleus) whose badge anchors at
  // circle.r (set to the coma radius) so it clears the coma circle.
  // 'polygon' = a soft closed outline (a Class-B morphology suggestion, e.g. a
  // pillar) drawn from `polygon`; an optional `arrow_to` adds the 迎光 arrow.
  // 'polyline' = an open thin line from `polygon` (a pillar's bright rim).
  /** 'field' is the subject the frame is a crop of — an object wider than the
   *  picture itself. It carries a circle for anchoring its badge, but nothing
   *  draws a ring for it: any ring would claim a boundary the frame does not
   *  contain. */
  shape: z
    .enum(['circle', 'shell', 'arrow', 'arc', 'dot', 'polygon', 'polyline', 'field'])
    .default('circle'),
  arrow_to: z.tuple([z.number(), z.number()]).optional(), // target point for shape 'arrow'
  /** Closed contour (shape 'polygon') or open line (shape 'polyline'), display px. */
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
  /** Curved segment for shape 'arc': centre (cx,cy), radius r, start/end angle
   * in radians (clockwise from +x, screen coords). circle.{cx,cy} stays at the
   * detected rim point so the badge anchors on the structure. */
  arc: z
    .object({ cx: z.number(), cy: z.number(), r: z.number(), a0: z.number(), a1: z.number() })
    .optional(),
  /** false → listed in the Facts panel but not drawn on the image (e.g. a shell
   * coincident with its parent nebula — drawing a duplicate ring is clutter). */
  draw: z.boolean().default(true),
  /**
   * The curator's say over this feature's magnified inset.
   *
   * Absent is the normal state: `planCallouts` decides whether this mark needs
   * one and where it goes. `off` refuses it — reversibly, which is the whole
   * reason it is a flag and not a deletion — and `x`/`y` pin the panel where
   * somebody dragged it.
   *
   * Pinned as an absolute position rather than an offset from the automatic
   * one: the automatic one moves when anything else on the frame moves, and an
   * offset from a moving origin is a panel that wanders after it is placed.
   */
  callout: z
    .object({
      off: z.boolean().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    })
    .optional(),
  badge: Badge,
  explanation: LocalizedString, // 2-3 sentences, plain language
  physics: LocalizedString.optional(), // mechanism / formation
  interesting: LocalizedString.optional(), // trivia, cross-references
  /** Carried from B-class facts until a human confirms placement. */
  needs_human_review: z.boolean().default(false),
});
export type Feature = z.infer<typeof Feature>;

export const ObjectInfo = z.object({
  // primary identifier, bilingual (zh + en). Legacy readings stored a plain
  // string — coerce it to both languages so they still load.
  name: z.preprocess((v) => (typeof v === 'string' ? { zh: v, en: v } : v), LocalizedString),
  aliases: z.array(z.string()).default([]),
  type: LocalizedString, // "发射星云" / "Emission nebula"
  stage: z.number().min(1).max(7).optional(), // Amy's lifecycle 1-7
  distance_ly: z.number().optional(),
  size_arcmin: z.number().optional(),
  constellation: z.string().optional(),
});
export type ObjectInfo = z.infer<typeof ObjectInfo>;

export const Reading = z.object({
  version: z.literal('2.0'),
  /** Link to the grounding fact sheet (by image hash). Optional until Stage 1 is wired. */
  source_factsheet: z.object({ hash: z.string() }).optional(),
  image: z.object({
    src: z.string(), // relative path, e.g. "image.jpg"
    width: z.number(),
    height: z.number(),
  }),
  display_language: z.enum(['zh', 'en']).default('zh'), // viewer default; content holds both
  tone: z.string().optional(), // tailoring tone/audience
  /**
   * The role the text was written or read for (a style key: `primary`,
   * `adult`, `teacher`). So a surface reopening the reading shows the role the
   * words belong to, not the configured default. Absent on readings made
   * before it was recorded, and on a stub with no text yet.
   */
  role: z.string().optional(),
  object: ObjectInfo,
  narrative: LocalizedString, // overall intro paragraph
  features: z.array(Feature),
  extra_facts: z.array(LocalizedString).default([]),
  created_at: z.string().datetime(),
  edited_at: z.string().datetime().optional(),
  generator: z.object({
    // Readings written before the rename say 'astrolens'; they still open, and
    // come back as 'astellum' so a re-save or re-render carries the new name.
    tool: z.enum(['astellum', 'astrolens']).transform(() => 'astellum' as const),
    tool_version: z.string(),
    llm: z.string(), // "claude-sonnet-4-x" etc
  }),
});
export type Reading = z.infer<typeof Reading>;

export const READING_VERSION = '2.0' as const;
