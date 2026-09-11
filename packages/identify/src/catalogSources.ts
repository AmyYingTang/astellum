import type { CatalogSource } from '@astellum/schema';
import type { CatalogClient } from './types.js';
import { createSimbadCatalogClient } from './simbad.js';
import { createVizierCatalogClient } from './vizier.js';
import { createOpenNgcCatalogClient } from './openngc.js';
import { createCompositeCatalogClient } from './composite.js';
import { createOfflineCatalogClient } from './offlineCatalog.js';
import { createCachedCatalogClient } from './catalogCache.js';

const log = (m: string): void => console.error(`[catalog] ${m}`);

/**
 * Build the catalog client from the profile's `catalog.sources`, so the choice
 * of "online catalogs" vs "the offline star-table pack" is one config field
 * rather than three call sites each hard-coding the same triple.
 *
 * `offline` is the on-disk pack (eight prefetched VizieR tables + OpenNGC),
 * which needs no network at all. It logs which tables are missing rather than
 * quietly under-delivering.
 */
export function createCatalogFromSources(
  sources: readonly CatalogSource[],
  opts: { snapshot?: boolean } = {},
): CatalogClient {
  const clients: CatalogClient[] = [];
  const used: string[] = [];
  for (const s of sources) {
    switch (s) {
      case 'simbad':
        clients.push(createSimbadCatalogClient());
        used.push('SIMBAD');
        break;
      case 'vizier':
        clients.push(createVizierCatalogClient());
        used.push('VizieR');
        break;
      case 'openngc':
        clients.push(createOpenNgcCatalogClient());
        used.push('OpenNGC');
        break;
      case 'offline':
        // The on-disk pack: eight prefetched VizieR tables + OpenNGC, no network.
        clients.push(createOfflineCatalogClient());
        used.push('offline pack');
        break;
      case 'snapshot':
        // Replayed online answers. `inner` is never reached in snapshot-only
        // mode, so pass a client that would fail loudly if it somehow were.
        clients.push(
          createCachedCatalogClient(
            {
              region: async () => {
                throw new Error('snapshot-only: no live catalogue is configured');
              },
            },
            { offline: true },
          ),
        );
        used.push('snapshot');
        break;
    }
  }
  if (!clients.length) {
    log('no catalog sources configured — identification will find nothing.');
  }
  log(`sources: ${used.join(' + ') || 'none'}`);
  const composite = createCompositeCatalogClient(clients);
  // Record what the live services answered, so the same field can be served
  // offline later. Pointless when nothing here touches the network.
  const live = sources.some((s) => s === 'simbad' || s === 'vizier');
  return opts.snapshot && live ? createCachedCatalogClient(composite) : composite;
}

/** True when no configured source needs the network. */
export function isOfflineCatalog(sources: readonly CatalogSource[]): boolean {
  return sources.every((s) => s === 'offline' || s === 'openngc' || s === 'snapshot');
}
