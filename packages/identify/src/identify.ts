import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { FactSheet, normalizeId, findRegistryEntry, type Registry } from '@astellum/schema';
import type { IdentifyInput, IdentifyDeps, CatalogCandidate } from './types.js';
import { worldToPixel } from './wcs.js';
import { objectCategory, isOptical } from './otype.js';
import type { GatedCandidate } from './select.js';
import { fieldRadiusDeg } from './wcs.js';
import { gateCandidates, selectObjects, hasRecognizableName } from './select.js';
import { assembleFactSheet } from './assemble.js';
import { loadRegistries } from './atlasApply.js';
import {
  createLuminanceSampler,
  createImageRaster,
  estimateBackground,
  type LuminanceSampler,
} from './luminance.js';
import { detectComet, cometToObjects, type CometFactObject } from './comet.js';
import {
  detectMorphology,
  selectForOutreach,
  applyIlluminationPrior,
  type MorphResult,
  type MorphFeature,
} from './morph.js';
import { visibleRadiusPx } from './features.js';
import { createWikidataClient } from './wikidata.js';
import { lookupNickname } from './nicknames.js';

async function fileHash(path: string): Promise<string> {
  const buf = await readFile(path);
  return 'sha256:' + createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/** Brightness-weighted centroid of the glow within radius `r` of (cx,cy) — a
 * proxy for the ionizing region (the embedded OB cluster). HII regions are
 * ionized by a whole hot-star cluster, not the single WR star we happen to
 * catalogue, so the bright core is the truer "toward the source" target for the
 * photoevaporation prior. Falls back to the catalog centre if no glow is sampled. */
function brightCentroid(
  cx: number,
  cy: number,
  r: number,
  s: LuminanceSampler,
  bg: number,
  w: number,
  h: number,
): [number, number] {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  const step = Math.max(6, Math.round(r / 40));
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y += step) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x += step) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const v = s(x, y);
      if (!Number.isFinite(v)) continue;
      const wt = v - bg;
      if (wt > 0) {
        sx += x * wt;
        sy += y * wt;
        sw += wt;
      }
    }
  }
  return sw > 0 ? [sx / sw, sy / sw] : [cx, cy];
}

/**
 * Stage 1: plate-solve + region catalog query → grounded FactSheet.
 * Solver and catalog are injected (nova / SIMBAD in production; mocks in tests).
 * Never fabricates identity: on solve failure it returns an honest empty sheet.
 */
/**
 * Find the operator-named target among the raw candidates and hand it back as a
 * gated candidate, when the normal gate has already dropped it.
 *
 * Returns undefined when there's no name, when the gate already kept it (the
 * common case — nothing to do), or when no candidate carries that name. It
 * never invents an identity: the object has to be in the catalogue results, at
 * a position that at least reaches the frame.
 */
/**
 * Every name the operator's chosen target is known by: what they typed, plus
 * the atlas registry's primary id and aliases for it. Curators name things the
 * way their audience does, which is often not what a catalogue calls them.
 */
function targetAliases(targetName: string | undefined, registry: Registry | null): string[] {
  const name = targetName?.trim();
  if (!name) return [];
  const entry = registry ? findRegistryEntry(registry, [name]) : undefined;
  return entry ? [...new Set([name, entry.primary_id, ...entry.aliases])] : [name];
}

function nameMatcher(names: readonly string[]): (c: CatalogCandidate) => boolean {
  const keys = new Set(names.map(normalizeId));
  return (c) =>
    keys.has(normalizeId(c.main_id)) ||
    c.names.some((n) => keys.has(normalizeId(n))) ||
    Object.values(c.catalog_ids).some((n) => keys.has(normalizeId(n)));
}

/** Promote a raw candidate to a gated one, skipping the centre-in-frame rule. */
function toGated(
  hit: CatalogCandidate,
  wcs: Parameters<typeof worldToPixel>[0],
): GatedCandidate | undefined {
  if (!isOptical(hit.otype)) return undefined;
  const category = objectCategory(hit.otype);
  if (!category) return undefined;
  // The centre may project outside the frame; that's the whole point. Downstream
  // only needs a pixel for placement, and atlas features carry their own sky
  // coordinates, so an off-frame host still projects its annotations correctly.
  const p = worldToPixel(wcs, hit.ra_deg, hit.dec_deg);
  if (!p) return undefined;
  return { candidate: hit, pixel: p, category };
}

function forceNamedTarget(
  targetNames: readonly string[],
  candidates: CatalogCandidate[],
  gated: GatedCandidate[],
  wcs: Parameters<typeof worldToPixel>[0],
): { gated: GatedCandidate; wasGated: boolean } | undefined {
  if (!targetNames.length) return undefined;
  const matches = nameMatcher(targetNames);

  // Already through the gate: nothing to rescue, but still worth pinning so the
  // prominence filter can't drop it later.
  const kept = gated.find((g) => matches(g.candidate));
  if (kept) return { gated: kept, wasGated: true };

  const radius = fieldRadiusDeg(wcs);
  const hit = candidates
    .filter(matches)
    // Its extent has to actually reach the frame — a same-named object on the
    // other side of the sky is a mismatch, not a target.
    .filter((c) => {
      const sep = angularSepDeg(wcs.ra0_deg, wcs.dec0_deg, c.ra_deg, c.dec_deg);
      return sep <= radius + (c.size_arcmin ? c.size_arcmin[0] / 2 / 60 : 0);
    })
    .sort((a, b) => (b.size_arcmin?.[0] ?? 0) - (a.size_arcmin?.[0] ?? 0))[0];
  const g = hit ? toGated(hit, wcs) : undefined;
  return g ? { gated: g, wasGated: false } : undefined;
}

const D2R = Math.PI / 180;
function angularSepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c =
    Math.sin(dec1 * D2R) * Math.sin(dec2 * D2R) +
    Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.cos((ra1 - ra2) * D2R);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D2R;
}

export async function identify(input: IdentifyInput, deps: IdentifyDeps): Promise<FactSheet> {
  const hash = input.hash ?? (await fileHash(input.imagePath));
  const timestamp = new Date().toISOString();
  const image = {
    src: input.imageSrc ?? basename(input.imagePath),
    width: input.width,
    height: input.height,
    hash,
    band: input.band ?? ('unknown' as const),
    starless: input.starless ?? false,
  };
  // "Main objects only" — focus on the subject + the standout companions of each
  // type, not every catalogued thing. Per-type caps adapt: a single-target field
  // stays at ~3-4; a genuine multi-target field (e.g. the Antares region: two
  // clusters + bright stars + nebulae) shows its handful of real main objects. A
  // single hard cap was dropping iconic objects (Antares), so it's only a safety.
  const selectOpts = {
    starMagMax: input.starMagMax ?? 4,
    nebulaMinArcmin: input.nebulaMinArcmin ?? 8,
    galaxyMinArcmin: input.galaxyMinArcmin ?? 3,
    maxStars: 2,
    maxClusters: 2,
    maxNebulae: 2,
    maxGalaxies: 1,
    topN: input.topN ?? 6, // safety ceiling only; per-type caps do the focusing
  };

  const solveRes = await deps.solve.solve({
    imagePath: input.imagePath,
    width: input.width,
    height: input.height,
    ...(input.solveHint ? { hint: input.solveHint } : {}),
  });

  if (solveRes.status !== 'solved' || !solveRes.wcs) {
    const status = input.targetName ? ('user_provided' as const) : ('failed' as const);
    const reason = solveRes.error ? ` Reason: ${solveRes.error}.` : '';
    const warnings =
      status === 'user_provided'
        ? [
            `Plate-solve failed.${reason} target_name "${input.targetName}" given, but name-only catalog resolution is not yet implemented (Phase 1c). No grounded objects produced — identity is never fabricated.`,
          ]
        : [
            `Plate-solve failed and no target_name provided.${reason} No objects — identity is never fabricated.`,
          ];
    return FactSheet.parse({
      version: '1.0',
      image,
      solve: { status, frame: 'none', nova_job_id: solveRes.nova_job_id },
      objects: [],
      warnings,
      provenance: { queries: [], solver: 'nova.astrometry.net', timestamp },
    });
  }

  const wcs = solveRes.wcs;
  const radius = fieldRadiusDeg(wcs);
  const candidates = await deps.catalog.region({
    ra_deg: wcs.ra0_deg,
    dec_deg: wcs.dec0_deg,
    radius_deg: radius,
  });
  const gated = gateCandidates(candidates, wcs);

  // "Verify", not "discover". When the operator has named the target up front —
  // which is the whole onsite flow — that name is better evidence of identity
  // than a cone search, so the gate must not be allowed to throw it away.
  //
  // The gate requires an object's *centre* to sit inside the frame. That is the
  // right default for discovery, but it drops exactly the cases a curator
  // actually shoots: a tight crop of a sub-structure (the Cone inside NGC 2264),
  // or a frame inside something enormous (Barnard's Loop, the Vela SNR). Those
  // fail against SIMBAD online for the same reason — it is not an offline
  // problem, and no extra catalogue fixes it.
  // Atlas Apply: B-class features are projected from the approved registry
  // (baseline + any user overlay, merged). Loaded here rather than at the end
  // because the registry also knows the target's aliases, and the operator may
  // well have picked a name no catalogue carries (the atlas calls the Vela SNR
  // "Gum 16"; the offline pack only knows it as "Vela SNR" / "SNR G263.9-03.3").
  const registry = input.registryPaths?.length ? await loadRegistries(input.registryPaths) : null;
  const targetNames = targetAliases(input.targetName, registry);

  let forced = forceNamedTarget(targetNames, candidates, gated, wcs);

  // Still nothing? The target may simply lie outside the cone we queried — a
  // tight crop of a sub-structure sits well off its catalogue centre. Widen the
  // search once, by name only. Offline this is a free in-memory filter; online
  // it costs one extra query, and only on the path that already failed.
  if (targetNames.length && !forced) {
    const wide = await deps.catalog.region({
      ra_deg: wcs.ra0_deg,
      dec_deg: wcs.dec0_deg,
      // At least a degree: a very tight crop can sit further from its own
      // catalogue centre than several of its own field widths.
      radius_deg: Math.min(Math.max(radius * 6, 1), 15),
    });
    const hit = wide.filter(nameMatcher(targetNames))[0];
    const g = hit ? toGated(hit, wcs) : undefined;
    if (g) {
      forced = { gated: g, wasGated: false };
      console.error(
        `[identify] target "${input.targetName}" found only by widening the search — ` +
          `this frame is a crop well off the object's catalogue centre.`,
      );
    }
  }

  if (forced && !forced.wasGated) {
    gated.unshift(forced.gated);
    console.error(
      `[identify] target "${input.targetName}" kept by name (${forced.gated.candidate.main_id}) — ` +
        `its catalogue centre lies outside the frame, so the cone gate would have dropped it.`,
    );
  }

  // Curated nickname overlay (amateur names absent from SIMBAD/Wikidata/OpenNGC,
  // e.g. Dark Doodad / Statue of Liberty), applied BEFORE selection so a famous
  // but survey-only object is recognized, fame-boosted, and kept — not just
  // labelled after the fact. See nicknames.ts.
  for (const g of gated) {
    const c = g.candidate;
    const nn = lookupNickname([...Object.values(c.catalog_ids), ...c.names, c.main_id]);
    if (nn) c.common_name = { en: nn.en, zh: nn.zh ?? c.common_name?.zh };
  }

  // Image luminance — gate candidates on actual visibility + snap Class-B
  // markers onto bright structure. Best effort: never fail if unreadable (tests).
  let sampler: LuminanceSampler | undefined;
  try {
    sampler = await createLuminanceSampler(input.imagePath, input.width, input.height);
  } catch {
    sampler = undefined;
  }
  const backgroundLum = sampler ? estimateBackground(sampler, wcs.width, wcs.height) : undefined;
  const visWindow = Math.max(8, Math.round(Math.min(wcs.width, wcs.height) / 50));

  // Comet detection — a comet is a moving object (no catalog), so it's read from
  // the image morphology: head/nucleus/coma + dust/ion tails. When found it's the
  // primary; the catalog objects (incidental background galaxies/stars) stay.
  let cometObjects: CometFactObject[] | undefined;
  try {
    const raster = await createImageRaster(input.imagePath, input.width, input.height);
    const comet = detectComet(raster, wcs, wcs.scale_deg * 3600);
    // A comet is a transient — it has NO catalog object at its position. If a
    // catalogued object sits at the detected head, it's that object (e.g. the
    // Pencil filament = NGC 2736), not a comet — a thin nebula can otherwise mimic
    // the head-plus-tail shape.
    if (comet) {
      const [nx, ny] = comet.nucleusPixel;
      const guard = Math.max(comet.comaRadiusPx * 3, 80);
      // Only a RECOGNIZABLE extended object (a real named nebula/galaxy, e.g. the
      // Pencil = NGC 2736) at the head vetoes. A background point star, or a faint
      // survey clump the comet is merely superimposed on (a Planck PGCC), must not.
      const onCatalogObject = gated.some(
        (g) =>
          g.candidate.size_arcmin &&
          hasRecognizableName(g.candidate) &&
          Math.hypot(g.pixel[0] - nx, g.pixel[1] - ny) < guard,
      );
      if (!onCatalogObject) cometObjects = cometToObjects(comet);
    }
  } catch {
    cometObjects = undefined; // best-effort
  }

  const selected = selectObjects(gated, {
    ...selectOpts,
    sampler,
    backgroundLum,
    visWindow,
    imageW: wcs.width,
    imageH: wcs.height,
  });
  // The prominence filter ranks by apparent size, so an operator-named target
  // with no catalogued extent (B 72, JnEr 1 …) can still be dropped here. If the
  // person running the kiosk said what this is, it leads the sheet.
  if (forced && !selected.includes(forced.gated)) {
    selected.unshift(forced.gated);
    console.error(`[identify] pinned named target "${input.targetName}" as primary.`);
  }
  console.error(
    `[identify] candidates=${candidates.length} → in-frame/known=${gated.length} → selected=${selected.length} (prominence filter, cap ${selectOpts.topN}): ${selected.map((g) => g.candidate.names[0] ?? g.candidate.main_id).join(', ')}`,
  );

  // Class-B morphology (pillars) — deterministic CV on the image (no AI). Run only
  // when an emission nebula is in the selected set (the morphology targets HII
  // pillars; skip galaxy/cluster/star fields to save the work). Best-effort: a
  // read/decode failure never breaks identification.
  let morphology: { result: MorphResult; selected: MorphFeature[] } | undefined;
  if (selected.some((g) => g.category === 'emission_nebula')) {
    try {
      const detected = await detectMorphology(input.imagePath);
      // Confine pillars to a selected emission nebula's VISIBLE glow — otherwise
      // the detector finds dark-column structure in unrelated foreground dust
      // (e.g. the Rho Oph clouds around M4) and mis-attributes it to a far, faint
      // nebula. Use the image-measured glow extent (the catalog size is often an
      // inflated footprint), falling back to the catalog radius.
      const ds = detected.downsample;
      const win = Math.max(8, Math.round(Math.min(wcs.width, wcs.height) / 50));
      const nebFoot = selected
        .filter((g) => g.category === 'emission_nebula' && g.candidate.size_arcmin)
        .map((g) => {
          const catR = (g.candidate.size_arcmin![0] * 60) / (wcs.scale_deg * 3600) / 2;
          let r = catR;
          let anchor: [number, number] = [g.pixel[0], g.pixel[1]];
          if (sampler && backgroundLum != null) {
            const vis = visibleRadiusPx(g.pixel, catR, sampler, backgroundLum, wcs.width, wcs.height, win);
            if (vis > win) r = vis;
            // Anchor the prior on the glow's bright centroid (the ionizing
            // cluster), not a single off-centre WR star.
            anchor = brightCentroid(g.pixel[0], g.pixel[1], r, sampler, backgroundLum, wcs.width, wcs.height);
          }
          return { x: g.pixel[0], y: g.pixel[1], r: r * 1.15, anchor };
        });
      const confined: MorphResult = {
        ...detected,
        features: nebFoot.length
          ? detected.features.filter((f) =>
              nebFoot.some(
                (n) => Math.hypot(f.centroid_px[0] * ds - n.x, f.centroid_px[1] * ds - n.y) <= n.r,
              ),
            )
          : [],
      };
      // Illumination prior: hard-filter pillars whose lit rim doesn't face the
      // nebula's bright ionizing centre (the embedded OB cluster — anchored on the
      // glow's bright centroid, not a single off-centre WR star). Also drops
      // non-pillar dark features (the Keyhole) whose geometry doesn't obey it. No
      // nebula glow ⇒ no prior (the set passes through as un-anchored B-visual).
      const anchors = nebFoot.map((n) => n.anchor);
      const result = applyIlluminationPrior(confined, anchors);
      const sel = selectForOutreach(result);
      if (sel.length) {
        morphology = { result, selected: sel };
        console.error(
          `[identify] morphology: ${detected.features.length} → ${confined.features.length} in-nebula → ${result.features.length} after illumination prior → ${sel.length} selected`,
        );
      }
    } catch {
      morphology = undefined;
    }
  }
  const queries = [
    `SIMBAD region r=${radius.toFixed(3)}deg @ (${wcs.ra0_deg.toFixed(3)}, ${wcs.dec0_deg.toFixed(3)})`,
  ];

  // Wikidata enrichment (Tier 1): for selected objects that have a common name
  // (⇒ famous), fetch a zh name + a mechanism-specific type. Best-effort, in
  // parallel; failures are swallowed inside the client.
  const wiki = createWikidataClient();
  await Promise.all(
    selected.map(async (g) => {
      const en = g.candidate.common_name?.en;
      if (!en) return;
      const info = await wiki.lookup(en);
      if (!info) return;
      // Don't overwrite a zh name the overlay already provided.
      if (info.name_zh && !g.candidate.common_name?.zh) {
        g.candidate.common_name = { ...g.candidate.common_name, zh: info.name_zh };
      }
      if (info.category) g.candidate.wiki_type = { category: info.category };
    }),
  );

  return assembleFactSheet({
    image,
    wcs,
    novaJobId: solveRes.nova_job_id,
    solveMs: solveRes.elapsed_ms,
    solveCached: solveRes.cached,
    solver: solveRes.solver,
    selected,
    queries,
    timestamp,
    sampler,
    cometObjects,
    morphology,
    registry,
  });
}
