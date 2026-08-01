export { identify } from './identify.js';
export { worldToPixel, pixelToWorld, fieldRadiusDeg } from './wcs.js';
export { gateCandidates, significance, type GatedCandidate } from './select.js';
export { assembleFactSheet, type AssembleArgs } from './assemble.js';
export {
  isOptical,
  objectCategory,
  featureTypeForOtype,
  categoryLabel,
  objectTypeLabel,
} from './otype.js';
export { createNovaSolveClient, type NovaOptions } from './nova.js';
export { createSimbadCatalogClient, type SimbadOptions } from './simbad.js';
export {
  createVizierCatalogClient,
  parseAsuTsv,
  VIZIER_CATALOGS,
  type VizierOptions,
} from './vizier.js';
export {
  createOpenNgcCatalogClient,
  parseOpenNgc,
  OPENNGC_CSV_URL,
  type OpenNgcOptions,
} from './openngc.js';
export { NICKNAMES, lookupNickname, type Nickname } from './nicknames.js';
export { createCompositeCatalogClient, mergeCandidates } from './composite.js';
export { createCatalogFromSources, isOfflineCatalog } from './catalogSources.js';
export {
  isFitsPath,
  decodeFits,
  autoStretch,
  readFitsForDisplay,
  fitsToPng,
  type FitsImage,
  type FitsReadResult,
  type StretchOptions,
} from './fits.js';
export {
  createCachedCatalogClient,
  catalogCacheStatus,
  defaultCatalogCacheDir,
  prewarmTargets,
  targetFootprint,
  type CatalogCacheOptions,
  type SnapshotStatus,
  type PrewarmEntry,
} from './catalogCache.js';
export {
  createOfflineCatalogClient,
  prefetchOfflineCatalogs,
  offlineCatalogStatus,
  isOfflineReady,
  defaultOfflineDir,
  type CatalogStatus,
  type PrefetchResult,
} from './offlineCatalog.js';
export { deriveBClassFeatures, visibleRadiusPx, type DerivableObject, type DerivedFeature } from './features.js';
export { detectCvFeatures, type CvOpts } from './cv.js';
export {
  createLuminanceSampler,
  createImageRaster,
  estimateBackground,
  type LuminanceSampler,
  type ImageRaster,
} from './luminance.js';
export { detectComet, cometToObjects, type CometResult, type CometTail, type CometFactObject } from './comet.js';
export {
  detectMorphology,
  selectForOutreach,
  applyIlluminationPrior,
  DEFAULT_MORPH_PARAMS,
  DEFAULT_SELECT_PARAMS,
  type MorphResult,
  type MorphFeature,
  type MorphParams,
  type SelectParams,
} from './morph.js';
export { createWikidataClient, type WikiInfo, type WikidataOptions } from './wikidata.js';
export { runAiFeaturePass, type RunClaudeFn } from './aiFeatures.js';
export {
  applyAtlas,
  atlasTypeFor,
  loadRegistry,
  loadRegistries,
  mergeRegistries,
  defaultRegistryPath,
  userRegistryPath,
  defaultRegistryPaths,
  type AtlasHost,
  type AtlasApplyResult,
} from './atlasApply.js';
export { createCachedSolveClient, defaultSolveCacheDir } from './cache.js';
export { createLocalSolveClient, type LocalSolveOptions } from './localSolve.js';
export { createConfiguredSolveClient, isLocalSolver, solverName } from './solveClient.js';
export type {
  Wcs,
  SolveClient,
  SolveInput,
  SolveResult,
  CatalogClient,
  CatalogCandidate,
  RegionQuery,
  IdentifyInput,
  IdentifyDeps,
} from './types.js';
