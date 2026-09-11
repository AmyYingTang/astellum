import { otypeLabel } from '@astellum/schema';
import type { ObjectCategory, FeatureType } from '@astellum/schema';

/**
 * SIMBAD otype → astellum taxonomy. MVP subset; extend as the corpus grows.
 * Source-of-truth for tiers is the Notion "可识别特征清单"; this is the machine
 * mapping the gate/select stage uses.
 */

/** otype codes that have NO optical counterpart in a processed photo → dropped by the gate. */
const NON_OPTICAL = new Set<string>([
  'Rad', 'mR', 'cm', 'mm', 'smm', 'HI', 'rB', 'Mas', // radio
  'X', 'ULX', ' gam', 'gam', 'gB', // x-ray / gamma
  'IR', 'FIR', 'MIR', 'NIR', // infrared-only
  'grv', 'Lev', 'gLe', 'GWE', 'BH', 'gLS', // gravitational / exotic
]);

/** otype → broad object category (for a primary/secondary catalogued object). */
const CATEGORY: Record<string, ObjectCategory> = {
  HII: 'emission_nebula',
  EmO: 'emission_nebula',
  'Cld': 'emission_nebula',
  GNe: 'emission_nebula',
  SNR: 'supernova_remnant',
  'SNR?': 'supernova_remnant',
  PN: 'planetary_nebula',
  'PN?': 'planetary_nebula',
  RNe: 'reflection_nebula',
  DNe: 'dark_nebula',
  MoC: 'dark_nebula',
  glb: 'dark_nebula', // globule
  GlC: 'globular_cluster',
  'GlC?': 'globular_cluster',
  OpC: 'open_cluster',
  'Cl*': 'open_cluster',
  G: 'galaxy',
  GiG: 'galaxy',
  GiC: 'galaxy',
  IG: 'galaxy',
  AGN: 'galaxy',
  Sy1: 'galaxy',
  Sy2: 'galaxy',
  SBG: 'galaxy',
  H2G: 'galaxy',
  EmG: 'galaxy',
  rG: 'galaxy',
  LSB: 'galaxy',
};

/** otype → feature type, when the object is a point-like feature inside a larger DSO. */
const FEATURE: Record<string, FeatureType> = {
  'WR*': 'wr_star',
  'WR?': 'wr_star',
  'C*': 'carbon_star',
  'C*?': 'carbon_star',
  '**': 'multiple_star',
  'EB*': 'multiple_star',
  WD: 'central_star',
  'WD*': 'central_star',
  HH: 'hh_jet',
  'Cl*': 'embedded_cluster',
  OpC: 'embedded_cluster',
  'Y*O': 'excitation_star',
  'Y*?': 'excitation_star',
  Star: 'named_star',
  '*': 'named_star',
  'V*': 'named_star',
  'Em*': 'named_star',
  'Be*': 'named_star',
  'HB*': 'named_star',
  's*b': 'named_star', // blue supergiant
  's*r': 'named_star', // red supergiant
};

/** Bilingual display name per category, for FactObject.type. */
const CATEGORY_LABELS: Record<ObjectCategory, { zh: string; en: string }> = {
  emission_nebula: { zh: '发射星云', en: 'Emission nebula' },
  planetary_nebula: { zh: '行星状星云', en: 'Planetary nebula' },
  supernova_remnant: { zh: '超新星遗迹', en: 'Supernova remnant' },
  reflection_nebula: { zh: '反射星云', en: 'Reflection nebula' },
  dark_nebula: { zh: '暗星云', en: 'Dark nebula' },
  galaxy: { zh: '星系', en: 'Galaxy' },
  globular_cluster: { zh: '球状星团', en: 'Globular cluster' },
  open_cluster: { zh: '疏散星团', en: 'Open cluster' },
  star: { zh: '恒星', en: 'Star' },
  comet: { zh: '彗星', en: 'Comet' },
};

export function categoryLabel(cat: ObjectCategory): { zh: string; en: string } {
  return CATEGORY_LABELS[cat];
}

/**
 * Display label for an object's type. Stars get the specific otype gloss
 * (s*r → 红超巨星 / WR* → Wolf–Rayet star) because their category label is just
 * "Star"; everything else keeps its clean category label. Shared gloss table
 * lives in @astellum/schema so the editor renders identical text.
 */
export function objectTypeLabel(otype: string, cat: ObjectCategory): { zh: string; en: string } {
  if (cat === 'star') return otypeLabel(otype) ?? categoryLabel(cat);
  return categoryLabel(cat);
}

export function isOptical(otype: string): boolean {
  return !NON_OPTICAL.has(otype.trim());
}

export function objectCategory(otype: string): ObjectCategory | null {
  const t = otype.trim();
  const mapped = CATEGORY[t];
  if (mapped) return mapped;
  // Most stellar otypes end in '*' (e.g. 's*r', 'bC*', 'WR*', 'V*', '**'); the
  // cluster codes (Cl*, GlC, OpC) are matched above, so anything left with a
  // '*' is treated as a (point-like) star object.
  if (t.includes('*')) return 'star';
  return null;
}

export function featureTypeForOtype(otype: string): FeatureType | null {
  return FEATURE[otype.trim()] ?? null;
}
