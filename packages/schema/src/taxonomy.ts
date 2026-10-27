import { z } from 'zod';
import type { ColorKey } from './colorKeys.js';

/** Broad object category — decides which feature set applies. */
export const ObjectCategory = z.enum([
  'emission_nebula', // 发射星云 / HII 区
  'planetary_nebula', // 行星状星云
  'supernova_remnant', // 超新星遗迹
  'reflection_nebula', // 反射星云
  'dark_nebula', // 暗星云 / 分子云
  'galaxy', // 星系
  'globular_cluster', // 球状星团
  'open_cluster', // 疏散星团
  'star', // 恒星 / 特殊星
  'comet', // 彗星
]);
export type ObjectCategory = z.infer<typeof ObjectCategory>;

/** Feature localization tier. Drives placement precision + human gate. */
export const FeatureClass = z.enum(['A', 'A+', 'B-anchor', 'B-visual']);
export type FeatureClass = z.infer<typeof FeatureClass>;

export interface FeatureTaxonomyEntry {
  zh: string;
  en: string;
  /** Default tier from the taxonomy; an instance's real class may differ (depends on catalog hit). */
  default_class: FeatureClass;
  /** Presentation default; reader/human may override on the reading layer. */
  default_color_key: ColorKey;
  catalogs: string[];
  applies_to: ObjectCategory[];
}

/**
 * Controlled vocabulary of identifiable optical features. Mirrors the Notion
 * "可识别特征清单" (Part 3) — that page is the source of truth; keep in sync.
 * Candidate pool: tier judgments need domain review before being treated as final.
 */
export const FEATURE_TAXONOMY = {
  // — Point / stellar sources —
  excitation_star: { zh: '激发星', en: 'Exciting star', default_class: 'A', default_color_key: 'hot', catalogs: ['SIMBAD O*'], applies_to: ['emission_nebula'] },
  wr_star: { zh: 'WR 星', en: 'Wolf–Rayet star', default_class: 'A', default_color_key: 'hot', catalogs: ['WR cat', 'SIMBAD WR*'], applies_to: ['emission_nebula', 'star'] },
  central_star: { zh: '中心星(白矮星)', en: 'Central star', default_class: 'A', default_color_key: 'hot', catalogs: ['SIMBAD'], applies_to: ['planetary_nebula'] },
  illuminating_star: { zh: '照亮星', en: 'Illuminating star', default_class: 'A', default_color_key: 'hot', catalogs: ['SIMBAD'], applies_to: ['reflection_nebula'] },
  named_star: { zh: '命名恒星', en: 'Named star', default_class: 'A', default_color_key: 'hot', catalogs: ['SIMBAD', 'HD/HIP/BSC'], applies_to: ['star', 'open_cluster'] },
  carbon_star: { zh: '碳星', en: 'Carbon star', default_class: 'A', default_color_key: 'star', catalogs: ['SIMBAD C*'], applies_to: ['star'] },
  multiple_star: { zh: '双星/聚星', en: 'Multiple star', default_class: 'A', default_color_key: 'star', catalogs: ['WDS'], applies_to: ['star'] },
  member_star: { zh: '著名成员星', en: 'Notable member star', default_class: 'A', default_color_key: 'hot', catalogs: ['SIMBAD'], applies_to: ['open_cluster', 'globular_cluster'] },
  supernova: { zh: '超新星(暂现)', en: 'Supernova', default_class: 'A', default_color_key: 'hot', catalogs: ['transient coord'], applies_to: ['galaxy'] },

  // — Clusters / cores —
  embedded_cluster: { zh: '嵌入星团', en: 'Embedded cluster', default_class: 'A', default_color_key: 'star', catalogs: ['OpC', 'SIMBAD Cl*'], applies_to: ['emission_nebula'] },
  cluster_core: { zh: '星团核/核心聚度', en: 'Cluster core', default_class: 'A', default_color_key: 'star', catalogs: ['center coord'], applies_to: ['globular_cluster', 'open_cluster'] },
  galaxy_nucleus: { zh: '星系核', en: 'Galactic nucleus', default_class: 'A', default_color_key: 'star', catalogs: ['center coord'], applies_to: ['galaxy'] },

  // — Outflow / jets —
  hh_jet: { zh: 'HH 喷流', en: 'Herbig–Haro jet', default_class: 'A', default_color_key: 'shock', catalogs: ['SIMBAD HH'], applies_to: ['emission_nebula'] },

  // — Ionization structures —
  ionization_front: { zh: '电离锋面', en: 'Ionization front', default_class: 'B-anchor', default_color_key: 'front', catalogs: ['anchor', 'BRC cat'], applies_to: ['emission_nebula'] },
  ionization_layering: { zh: '电离分层', en: 'Ionization stratification', default_class: 'B-visual', default_color_key: 'front', catalogs: ['color region'], applies_to: ['planetary_nebula', 'emission_nebula'] },

  // — Pillars / globules —
  pillar: { zh: '柱状', en: 'Pillar', default_class: 'B-visual', default_color_key: 'pillar', catalogs: ['CV', 'anchor'], applies_to: ['emission_nebula'] },
  // Same colour as a pillar on purpose: it is the same physics seen at a
  // different stage, and an audience reads the two as one family. The split is
  // so a careful annotator can say which one they drew.
  elephant_trunk: { zh: '象鼻', en: 'Elephant trunk', default_class: 'B-visual', default_color_key: 'pillar', catalogs: ['CV', 'anchor'], applies_to: ['emission_nebula'] },
  cometary_globule: { zh: '彗状球状体', en: 'Cometary globule', default_class: 'B-anchor', default_color_key: 'pillar', catalogs: ['CG cat', 'anchor'], applies_to: ['emission_nebula'] },
  bok_globule: { zh: 'Bok 球状体', en: 'Bok globule', default_class: 'A+', default_color_key: 'dark', catalogs: ['Barnard', 'LDN', 'CB'], applies_to: ['emission_nebula', 'dark_nebula'] },

  // — Dust —
  dark_cloud: { zh: '命名暗云', en: 'Dark cloud', default_class: 'A+', default_color_key: 'dark', catalogs: ['Barnard', 'LDN', 'CB', 'Sandqvist'], applies_to: ['dark_nebula'] },
  dust_lane: { zh: '尘埃带/暗带', en: 'Dust lane', default_class: 'A+', default_color_key: 'dark', catalogs: ['Barnard', 'LDN'], applies_to: ['emission_nebula', 'dark_nebula'] },
  silhouette_shape: { zh: '剪影形状', en: 'Silhouette shape', default_class: 'B-visual', default_color_key: 'dark', catalogs: ['morphology'], applies_to: ['dark_nebula'] },

  // — Shells / cavities —
  pn_shell: { zh: '行星状外壳/halo', en: 'PN shell', default_class: 'A+', default_color_key: 'shell', catalogs: ['named extent', 'morphology'], applies_to: ['planetary_nebula'] },
  bubble_shell: { zh: '气泡壳/星风壳', en: 'Wind-blown shell', default_class: 'B-visual', default_color_key: 'shell', catalogs: ['morphology', 'anchor'], applies_to: ['emission_nebula'] },
  // A lobe is a shell that a waist has pinched in two; same colour family.
  bipolar_lobe: { zh: '双极叶', en: 'Bipolar lobe', default_class: 'B-visual', default_color_key: 'shell', catalogs: ['morphology'], applies_to: ['planetary_nebula', 'emission_nebula'] },
  central_cavity: { zh: '中央空腔/星风腔', en: 'Central cavity', default_class: 'B-visual', default_color_key: 'cavity', catalogs: ['morphology'], applies_to: ['emission_nebula', 'planetary_nebula'] },
  ansae_flier: { zh: 'ansae/FLIER', en: 'Ansae · FLIER', default_class: 'B-visual', default_color_key: 'shock', catalogs: ['morphology'], applies_to: ['planetary_nebula'] },

  // — Shocks —
  // A front made by a collision — a stellar wind, or a star moving faster than
  // sound through the gas — rather than by starlight. Traced as an edge, like
  // an ionization front; coloured with the other shocks so an audience reads
  // the cyan as one family.
  shock_front: { zh: '激波结构', en: 'Shock front', default_class: 'B-visual', default_color_key: 'shock', catalogs: ['morphology'], applies_to: ['emission_nebula', 'planetary_nebula', 'supernova_remnant'] },

  // — SNR —
  snr_filament: { zh: '遗迹丝状', en: 'SNR filament', default_class: 'B-visual', default_color_key: 'shock', catalogs: ['CV(Frangi)'], applies_to: ['supernova_remnant'] },
  emission_color_region: { zh: 'OIII/Hα 结构区', en: 'Emission color region', default_class: 'B-visual', default_color_key: 'front', catalogs: ['color region'], applies_to: ['supernova_remnant', 'emission_nebula'] },

  // — Galaxy morphology —
  spiral_arm: { zh: '旋臂', en: 'Spiral arm', default_class: 'B-anchor', default_color_key: 'bg', catalogs: ['CV log-spiral', 'anchor nucleus'], applies_to: ['galaxy'] },
  galaxy_dust_lane: { zh: '星系尘埃带', en: 'Galaxy dust lane', default_class: 'B-visual', default_color_key: 'dark', catalogs: ['morphology'], applies_to: ['galaxy'] },
  hii_knot: { zh: '内部 HII 区/恒星形成结', en: 'HII knot', default_class: 'A+', default_color_key: 'front', catalogs: ['NGC + coord'], applies_to: ['galaxy'] },
  companion_galaxy: { zh: '伴星系', en: 'Companion galaxy', default_class: 'A', default_color_key: 'star', catalogs: ['NGC', 'IC'], applies_to: ['galaxy'] },
  tidal_tail: { zh: '潮汐尾', en: 'Tidal tail', default_class: 'B-anchor', default_color_key: 'bg', catalogs: ['anchor connecting line'], applies_to: ['galaxy'] },

  // — Reflection —
  reflection_structure: { zh: '蓝色/条纹结构', en: 'Reflection structure', default_class: 'B-visual', default_color_key: 'bg', catalogs: ['morphology'], applies_to: ['reflection_nebula'] },

  // — Globular cluster color —
  stellar_population: { zh: '红巨星/蓝 HB 颜色', en: 'Stellar population', default_class: 'B-visual', default_color_key: 'star', catalogs: ['color region'], applies_to: ['globular_cluster'] },

  // — Comet (time-sensitive) —
  comet_nucleus: { zh: '核', en: 'Nucleus', default_class: 'B-visual', default_color_key: 'hot', catalogs: ['morphology'], applies_to: ['comet'] },
  comet_coma: { zh: '彗发', en: 'Coma', default_class: 'A', default_color_key: 'comet', catalogs: ['morphology'], applies_to: ['comet'] },
  comet_dust_tail: { zh: '尘埃尾', en: 'Dust tail', default_class: 'B-visual', default_color_key: 'star', catalogs: ['morphology'], applies_to: ['comet'] },
  comet_ion_tail: { zh: '离子尾', en: 'Ion tail', default_class: 'B-visual', default_color_key: 'ion', catalogs: ['morphology'], applies_to: ['comet'] },
  comet_tail: { zh: '彗尾', en: 'Comet tail', default_class: 'B-visual', default_color_key: 'comet', catalogs: ['morphology'], applies_to: ['comet'] },
} satisfies Record<string, FeatureTaxonomyEntry>;

export type FeatureTypeKey = keyof typeof FEATURE_TAXONOMY;

/** Closed enum of feature types, derived from the registry keys (no drift). */
export const FeatureType = z.enum(
  Object.keys(FEATURE_TAXONOMY) as [FeatureTypeKey, ...FeatureTypeKey[]],
);
export type FeatureType = z.infer<typeof FeatureType>;

/** Deterministic feature_type → palette key (reader/human may still override). */
export function featureColorKey(ft: FeatureType): ColorKey {
  return FEATURE_TAXONOMY[ft].default_color_key;
}

const CATEGORY_COLOR: Record<ObjectCategory, ColorKey> = {
  emission_nebula: 'emission',
  planetary_nebula: 'shell',
  supernova_remnant: 'shock',
  reflection_nebula: 'bg',
  dark_nebula: 'dark',
  galaxy: 'cavity', // pale lavender — distinct from the mint 'bg' / green comet coma
  globular_cluster: 'star',
  open_cluster: 'star',
  star: 'hot',
  comet: 'comet',
};

/** Deterministic object-category → palette key, for annotating whole objects. */
export function categoryColorKey(cat: ObjectCategory): ColorKey {
  return CATEGORY_COLOR[cat];
}
