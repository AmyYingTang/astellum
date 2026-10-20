// Feature-type registry — the B-class morphology vocabulary (TOOL_HANDOFF §4).
//
// Config-driven on purpose: Amy adds/removes types here, not scattered through
// UI + server logic. Geometry decides how it's drawn; `defaultOn` is the first
// slice we build the seed atlas with. Bilingual labels are mandatory.
//
// NOTE: the consumer is Atlas Apply (packages/identify/src/atlasApply.ts), which
// bridges these keys to the pipeline taxonomy. Promoting this list into
// @astellum/schema so both sides share one source is still worth doing.

export type Geometry = 'polygon' | 'polyline' | 'point';

export interface FeatureType {
  key: string;
  zh: string;
  en: string;
  /** Default drawing geometry for this type (can be overridden per annotation). */
  geometry: Geometry;
  /** Part of the first "default" slice we seed the atlas with. */
  defaultOn: boolean;
  /** A hint colour for the canvas overlay (not the final consumer style). */
  hint: string;
  /** Superseded by finer types, kept so annotations already drawn with it still
   *  resolve to a name and a pipeline type. Hidden from the picker; nothing new
   *  should be drawn with one. */
  legacy?: boolean;
}

export const FEATURE_TYPES: readonly FeatureType[] = [
  // Pillars. Same hint colour for both: one family, two stages of the same
  // erosion — the split is so the annotator can say which one they drew.
  { key: 'pillar',           zh: '柱',                   en: 'Pillar',                      geometry: 'polygon',  defaultOn: true,  hint: '#ff9e64' },
  { key: 'elephant_trunk',   zh: '象鼻',                 en: 'Elephant trunk',              geometry: 'polygon',  defaultOn: true,  hint: '#ff9e64' },

  { key: 'bright_rim',       zh: '电离锋面',             en: 'Ionization Front',            geometry: 'polyline', defaultOn: true,  hint: '#2ac3de' },
  { key: 'filament',         zh: '丝状结构',             en: 'Filament',                    geometry: 'polyline', defaultOn: true,  hint: '#bb9af7' },
  { key: 'silhouette',       zh: '剪影暗形',             en: 'Dark Silhouette',             geometry: 'polygon',  defaultOn: true,  hint: '#565f89' },

  // Globules. Bok and cometary are different objects, not two words for one —
  // the taxonomy has always had them apart; only this list merged them.
  { key: 'bok_globule',      zh: 'Bok 球',               en: 'Bok globule',                 geometry: 'polygon',  defaultOn: true,  hint: '#414868' },
  { key: 'cometary_globule', zh: '彗状球',               en: 'Cometary globule',            geometry: 'polygon',  defaultOn: true,  hint: '#414868' },

  { key: 'dust_lane',        zh: '尘埃暗带',             en: 'Dust Lane',                   geometry: 'polyline', defaultOn: true,  hint: '#7aa2f7' },

  // Shells. A lobe is a shell a waist has pinched in two.
  { key: 'shell',            zh: '壳 / 泡',              en: 'Shell / Bubble',              geometry: 'polygon',  defaultOn: true,  hint: '#9ece6a' },
  { key: 'bipolar_lobe',     zh: '双极叶',               en: 'Bipolar lobe',                geometry: 'polygon',  defaultOn: true,  hint: '#9ece6a' },

  { key: 'spiral_arm',       zh: '旋臂',                 en: 'Spiral Arm',                  geometry: 'polyline', defaultOn: true,  hint: '#e0af68' },
  { key: 'tidal_tail',       zh: '潮汐尾',               en: 'Tidal Tail',                  geometry: 'polyline', defaultOn: false, hint: '#f7768e' },
  { key: 'region',           zh: '区域标注',             en: 'Region callout',              geometry: 'polygon',  defaultOn: false, hint: '#73daca' },

  // Outflows. An HH jet comes out of a forming star; ansae/FLIERs sit at the
  // ends of a planetary nebula. Nothing but this list ever called them one type.
  { key: 'hh_jet',           zh: 'HH 喷流',              en: 'Herbig–Haro jet',             geometry: 'polyline', defaultOn: false, hint: '#ff007c' },
  { key: 'ansae_flier',      zh: 'ansae / FLIER',        en: 'Ansae · FLIER',               geometry: 'polyline', defaultOn: false, hint: '#ff007c' },

  // Superseded above. Still here because a deployment's own ~/.astellum overlay
  // may hold annotations drawn with them, and nothing validates feature_type on
  // read — drop these keys and those annotations quietly become region callouts.
  { key: 'globule',          zh: '暗球 / Bok球 / 彗状球', en: 'Globule (Bok / cometary)',    geometry: 'polygon',  defaultOn: false, hint: '#414868', legacy: true },
  { key: 'jet',              zh: '喷流',                 en: 'Jet (HH / ansae / FLIER)',    geometry: 'polyline', defaultOn: false, hint: '#ff007c', legacy: true },
] as const;

const BY_KEY = new Map(FEATURE_TYPES.map((f) => [f.key, f]));

export function featureType(key: string): FeatureType | undefined {
  return BY_KEY.get(key);
}
