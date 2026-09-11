import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import sharp from 'sharp';
import {
  identify,
  createConfiguredSolveClient,
  createSimbadCatalogClient,
  createVizierCatalogClient,
  createOpenNgcCatalogClient,
  createCompositeCatalogClient,
  defaultRegistryPaths,
} from '@astellum/identify';

export interface IdentifyArgs {
  image: string;
  target?: string;
  out: string;
  band?: string;
  starless?: boolean;
  topN?: number;
  apiKey?: string;
  cache?: boolean;
}

/** Stage 1 only: plate-solve + catalog → factsheet.json (no LLM). */
export async function identifyImage(args: IdentifyArgs): Promise<void> {
  const apiKey = args.apiKey ?? process.env.ASTROMETRY_API_KEY;
  const imagePath = resolve(args.image);
  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) throw new Error(`Could not read image dimensions: ${imagePath}`);

  const outDir = resolve(args.out);
  await mkdir(outDir, { recursive: true });
  const imageName = `image${(extname(imagePath) || '.jpg').toLowerCase()}`;

  const band =
    args.band === 'broadband' || args.band === 'narrowband' ? args.band : ('unknown' as const);

  const solve = createConfiguredSolveClient({ apiKey, cache: args.cache });

  console.log('Plate-solving (nova — this can take 30s to a few minutes; cached after the first solve)…');
  const factsheet = await identify(
    {
      imagePath,
      width: meta.width,
      height: meta.height,
      imageSrc: imageName,
      targetName: args.target,
      band,
      starless: args.starless,
      topN: args.topN,
      registryPaths: defaultRegistryPaths(),
    },
    {
      solve,
      catalog: createCompositeCatalogClient([
        createSimbadCatalogClient(),
        createVizierCatalogClient(),
        createOpenNgcCatalogClient(),
      ]),
    },
  );

  const s = factsheet.solve;
  if (s.status !== 'solved') {
    console.log(`Plate-solve: ${s.status}${s.solve_ms != null ? ` after ${(s.solve_ms / 1000).toFixed(1)}s` : ''}.`);
  } else {
    console.log(
      `Plate-solved in ${s.solve_cached ? 'cache (instant)' : `${((s.solve_ms ?? 0) / 1000).toFixed(1)}s`}` +
        `${s.nova_job_id ? ` — nova job ${s.nova_job_id}` : ''}.`,
    );
  }

  await copyFile(imagePath, join(outDir, imageName));
  const factsheetPath = join(outDir, 'factsheet.json');
  await writeFile(factsheetPath, JSON.stringify(factsheet, null, 2) + '\n', 'utf8');

  console.log(`Wrote ${factsheetPath}`);
  console.log(`Solve: ${factsheet.solve.status} (frame=${factsheet.solve.frame})`);
  console.log(`Objects: ${factsheet.objects.length}`);
  for (const o of factsheet.objects) {
    const flags = [o.tier === 'B' ? 'B-class' : null, o.needs_human_review ? 'needs review' : null]
      .filter(Boolean)
      .join(', ');
    console.log(`  [${o.role}] ${o.names[0]} — ${o.type.en}${flags ? ` · ${flags}` : ''}`);
  }
  for (const w of factsheet.warnings) console.log(`  ⚠ ${w}`);
}
