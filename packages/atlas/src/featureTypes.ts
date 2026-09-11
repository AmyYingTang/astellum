// Feature-type registry — the B-class morphology vocabulary (TOOL_HANDOFF §4).
//
// Config-driven on purpose: Amy adds/removes types here, not scattered through
// UI + server logic. Geometry decides how it's drawn; `defaultOn` is the first
// slice we build the seed atlas with. Bilingual labels are mandatory.
//
// NOTE: the consumer (Atlas Apply) will need feature_type → render-style too;
// when that lands, promote this list into @astellum/schema so both sides share
// one source. Kept local to the tool for now (no consumer yet).

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
}

export const FEATURE_TYPES: readonly FeatureType[] = [
  { key: 'pillar', zh: '象鼻 / 柱', en: 'Pillar / Elephant Trunk', geometry: 'polygon', defaultOn: true, hint: '#ff9e64' },
  { key: 'bright_rim', zh: '电离锋面', en: 'Ionization Front', geometry: 'polyline', defaultOn: true, hint: '#2ac3de' },
  { key: 'filament', zh: '丝状结构', en: 'Filament', geometry: 'polyline', defaultOn: true, hint: '#bb9af7' },
  { key: 'silhouette', zh: '剪影暗形', en: 'Dark Silhouette', geometry: 'polygon', defaultOn: true, hint: '#565f89' },
  { key: 'globule', zh: '暗球 / Bok球 / 彗状球', en: 'Globule (Bok / cometary)', geometry: 'polygon', defaultOn: true, hint: '#414868' },
  { key: 'dust_lane', zh: '尘埃暗带', en: 'Dust Lane', geometry: 'polyline', defaultOn: true, hint: '#7aa2f7' },
  { key: 'shell', zh: '壳 / 泡 / 双极叶', en: 'Shell / Bubble / Lobe', geometry: 'polygon', defaultOn: true, hint: '#9ece6a' },
  { key: 'spiral_arm', zh: '旋臂', en: 'Spiral Arm', geometry: 'polyline', defaultOn: true, hint: '#e0af68' },
  { key: 'tidal_tail', zh: '潮汐尾', en: 'Tidal Tail', geometry: 'polyline', defaultOn: false, hint: '#f7768e' },
  { key: 'region', zh: '区域标注', en: 'Region callout', geometry: 'polygon', defaultOn: false, hint: '#73daca' },
  { key: 'jet', zh: '喷流', en: 'Jet (HH / ansae / FLIER)', geometry: 'polyline', defaultOn: false, hint: '#ff007c' },
] as const;

const BY_KEY = new Map(FEATURE_TYPES.map((f) => [f.key, f]));

export function featureType(key: string): FeatureType | undefined {
  return BY_KEY.get(key);
}
