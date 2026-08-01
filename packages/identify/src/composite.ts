import type { CatalogClient, CatalogCandidate, RegionQuery } from './types.js';
import { objectCategory } from './otype.js';
import { lookupNickname } from './nicknames.js';

/**
 * Fan a region query out to several catalog clients (SIMBAD + VizieR) and merge,
 * collapsing cross-source duplicates of the same object — e.g. the same nebula
 * catalogued as both "Sh 2-308" and "RCW 11", or a star present in both SIMBAD
 * and a VizieR table. The survivor keeps the most authoritative name and gains
 * the others as aliases / catalog ids.
 */

/** Merge key = the full object category, so an emission nebula is never folded
 * into a co-located dark cloud or planetary nebula — only true duplicates. */
function kindOf(c: CatalogCandidate): string {
  return objectCategory(c.otype) ?? 'other';
}

/** Approximate angular separation in arcmin (cos-corrected; fine for small fields). */
function sepArcmin(a: CatalogCandidate, b: CatalogCandidate): number {
  const dDec = a.dec_deg - b.dec_deg;
  const dRa = (a.ra_deg - b.ra_deg) * Math.cos((a.dec_deg * Math.PI) / 180);
  return Math.hypot(dDec, dRa) * 60;
}

/** Ranking so the survivor of a merge carries the best-known designation. */
function prestige(c: CatalogCandidate): number {
  if (c.catalog_ids.messier) return 5;
  if (c.catalog_ids.ngc || c.catalog_ids.ic) return 4;
  if (c.catalog_ids.sharpless) return 3.5; // canonical HII name — prefer over a generic SIMBAD id
  if (c.source.startsWith('SIMBAD')) return 3;
  return Object.keys(c.catalog_ids).length > 0 ? 2 : 1;
}

function major(c: CatalogCandidate): number {
  return c.size_arcmin?.[0] ?? 0;
}

/** A human-given nickname (e.g. NGC 3576 = Statue of Liberty) marks the canonical
 * member of a complex catalogued under several numbers — make it the survivor. */
function fame(c: CatalogCandidate): number {
  return lookupNickname([...Object.values(c.catalog_ids), ...c.names]) ? 1 : 0;
}

/**
 * Two same-kind candidates are the same object if their centres are close
 * relative to their size (generous for extended nebulae, tight for stars).
 *
 * The scale that matters is the SMALLER of the two, and the pair also has to be
 * comparable in size — the same guard `isSameComplex` already applies across
 * categories, and its absence here was a real bug. Sizing the threshold off the
 * larger one meant a giant HII complex swallowed any small nebula inside it:
 * Sh 2-310 is 480′, so 0.6 × 480 = 288′ of reach, and Sh 2-308 (35′) —
 * a distinct, separately catalogued Wolf–Rayet bubble sitting inside that
 * reach — vanished into it, taking the whole reading with it.
 *
 * A small nebula inside a big complex is a sub-object, not a duplicate. When it
 * really is one object listed twice, the two entries agree to within the
 * smaller one's own scale anyway.
 */
function isDuplicate(a: CatalogCandidate, b: CatalogCandidate): boolean {
  if (kindOf(a) !== kindOf(b) || kindOf(a) === 'other') return false;
  const big = Math.max(major(a), major(b));
  const small = Math.min(major(a), major(b));
  // Both sized but wildly different ⇒ one contains the other; keep them apart.
  if (small > 0 && small < 0.4 * big) return false;
  const scale = small > 0 ? small : big;
  const threshold = Math.max(scale > 0 ? 5 : 2, 0.6 * scale);
  return sepArcmin(a, b) <= threshold;
}

/** Bright diffuse-nebula categories whose catalogues overlap — the same complex
 * is listed as both an HII region and a "reflection" Cederblad entry. */
const BRIGHT_NEBULA = new Set(['emission_nebula', 'reflection_nebula']);

/** The same physical complex catalogued across mechanisms — e.g. Carina as both
 * NGC 3372 (HII, 210′) and Ced 109 (RNe, 120′ — Cederblad blanket-types as
 * reflection). Merge a CROSS-category bright-nebula pair only when concentric and
 * comparable in size, so a genuine small reflection nebula embedded in a big HII
 * region (a real sub-object) is never swallowed. */
function isSameComplex(a: CatalogCandidate, b: CatalogCandidate): boolean {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka === kb) return false; // same category → isDuplicate already handles it
  if (!BRIGHT_NEBULA.has(ka) || !BRIGHT_NEBULA.has(kb)) return false;
  const big = Math.max(major(a), major(b));
  const small = Math.min(major(a), major(b));
  if (small <= 0 || small < 0.4 * big) return false; // comparable, not a sub-nebula
  return sepArcmin(a, b) <= 0.3 * small; // concentric
}

export function mergeCandidates(lists: CatalogCandidate[][]): CatalogCandidate[] {
  const all = lists.flat();
  // Preferred representative first (prestige, then larger size, then brighter),
  // so the first kept of a duplicate group is the survivor and later ones fold
  // into it. The brightness tiebreak matters for close binaries like α Sco A/B:
  // without it the faint companion can win and then fail the prominence cut.
  all.sort(
    (a, b) =>
      prestige(b) - prestige(a) ||
      fame(b) - fame(a) ||
      major(b) - major(a) ||
      (a.mag ?? 99) - (b.mag ?? 99),
  );

  const designationOf = (c: CatalogCandidate): string =>
    Object.values(c.catalog_ids)[0] ?? c.names[0] ?? c.main_id;

  const kept: CatalogCandidate[] = [];
  for (const c of all) {
    const dup = kept.find((o) => isDuplicate(o, c) || isSameComplex(o, c));
    if (!dup) {
      kept.push({
        ...c,
        names: [...c.names],
        catalog_ids: { ...c.catalog_ids },
        cross_match: [...(c.cross_match ?? [])],
      });
      continue;
    }
    for (const n of c.names) if (!dup.names.includes(n)) dup.names.push(n);
    for (const [k, v] of Object.entries(c.catalog_ids)) if (!dup.catalog_ids[k]) dup.catalog_ids[k] = v;
    if (major(c) > major(dup)) dup.size_arcmin = c.size_arcmin;
    // The common name can live on either source — keep whichever has it.
    if (!dup.common_name?.en && c.common_name?.en) dup.common_name = c.common_name;
    // Record the folded-in designation + its separation from the kept position,
    // so the UI can show the cross-ID is the same physical object. Skip when the
    // folded id equals the survivor's own designation (two sources of the same
    // catalog id → would read "RCW 57 ↔ RCW 57"), or is already recorded.
    const foldedId = designationOf(c);
    const ownId = designationOf(dup);
    (dup.cross_match ??= []);
    if (foldedId && foldedId !== ownId && !dup.cross_match.some((x) => x.id === foldedId)) {
      dup.cross_match.push({
        id: foldedId,
        sep_arcmin: Math.round(sepArcmin(dup, c) * 10) / 10,
      });
    }
  }
  return kept;
}

export function createCompositeCatalogClient(clients: CatalogClient[]): CatalogClient {
  return {
    async region(q: RegionQuery): Promise<CatalogCandidate[]> {
      const lists = await Promise.all(
        clients.map((c) => c.region(q).catch(() => [] as CatalogCandidate[])),
      );
      return mergeCandidates(lists);
    },
  };
}
