# Setting up astrolens

From a fresh `git clone` to a running system, on any machine.

Once it runs, see **[CURATING.md](CURATING.md)** for the annotate → review →
write workflow, and **[ONSITE.md](ONSITE.md)** for running it at an event.

---

## 1. What you actually need

| Needed | Why | Check |
|---|---|---|
| **Node ≥ 18** | runtime | `node -v` |
| **pnpm 9** | workspace package manager | `pnpm -v` (`corepack enable pnpm`) |
| **A plate-solver** | every image is solved before anything can be placed | §3 |
| `claude` CLI *(optional)* | only for AI-written text | `which claude` |

Two things surprise people, so they are worth saying plainly:

- **The local solver is two separate installs.** `brew install astrometry-net`
  gets the *program* (`solve-field`, `wcsinfo`); the *index files* are a
  separate download sized to your field of view (§3B). Having one without the
  other looks like a broken solver.
- **`puppeteer` pulls its own Chromium** on `pnpm install` — a few hundred MB,
  and only used for poster export. Expected, not a mistake.

Without the `claude` CLI everything works **except** AI-written text.
Identification, annotation, predefined readings and export are unaffected.

## 2. Install

```bash
git clone git@github.com:AmyYingTang/astrolens.git
cd astrolens
./quickastrolens setup        # pnpm install + build everything
```

## 3. Pick a plate-solver

Every image is plate-solved to get its WCS (sky ↔ pixel) — that is what places
catalogue objects and projects atlas annotations. You need **one** of these;
nothing works without it. The solver is pluggable.

### Option A — nova.astrometry.net (easiest)

Robust blind solver, no local data. Needs internet and a free API key; it goes
through a shared remote queue, so solve time varies from seconds to minutes.
Get a key at <https://nova.astrometry.net> (Profile → API key):

```bash
echo 'ASTROMETRY_API_KEY=your-key-here' >> .env    # repo root; .env is gitignored
```

### Option B — local astrometry.net (offline, seconds per solve)

The **same** blind-solve engine as nova, run locally: no queue, no network.
Required for field use, and worth it anywhere for predictable timing.

> ASTAP is **not** a good substitute: it is fast but fails on heavily processed /
> star-reduced finished astrophotos that nova and local astrometry.net handle.

```bash
brew install astrometry-net          # the program
```

Then the index files. **Their size is decided entirely by the narrowest field
you need to solve** — a solve matches an index about a third of the field's
width, and each finer band is roughly twice the size of the one above it:

| supports fields | download |
|---|---|
| 120′ and wider | 311 MB |
| 88′ and wider | 624 MB |
| 64′ and wider | 1.2 GB |
| 44′ and wider | 2.4 GB |
| 32′ and wider | 4.9 GB |

Pick the widest one that covers your rigs — going one row further down doubles
the download for fields you may never shoot.

```bash
./quickastrolens prefetch indexes 64      # or from the settings page, §5
echo "add_path $HOME/astrometry-indexes" >> "$(brew --prefix)/etc/astrometry.cfg"
```

The download resumes: re-running checks each file's size against the server and
re-fetches only what is missing or truncated. That second line is what tells the
solver where they are — without it the files sit unused.

Turn the solver on, optionally hinting the field width in degrees (the hint
speeds solving a lot):

```bash
# .env
ASTROLENS_SOLVER=local
ASTROLENS_FOV_LOW=2
ASTROLENS_FOV_HIGH=3.5
```

**Env reference:** `ASTROLENS_SOLVER` (`local`|`nova`), `ASTROMETRY_CFG`,
`SOLVE_FIELD`, `WCSINFO` (binary/config paths), `ASTROLENS_FOV_LOW` /
`ASTROLENS_FOV_HIGH`.

### Which solver is active?

Three places tell you — worth a glance before a live session:

1. **Startup log** — `Plate-solver: …`.
2. **In the UI** — a badge on the navigation page and the atlas top bar, green
   when it is the offline local one.
3. **After the fact** — `factsheet.solve.solver`, per reading. On a cache hit
   that is the solver that *originally* solved the image.

Successful solves are cached in `~/.cache/astrolens/solve`, so re-solving the
same image is instant regardless of solver.

## 4. Run it

```bash
./quickastrolens
```

Opens a navigation page at **<http://localhost:3000>** with four cards:

| | port | what |
|---|---|---|
| **Studio** | 3010 | make a frame: upload, identify, adjust annotations, AI reading, export |
| **Atlas** | 3100 | draw and review the baseline annotations |
| **Kiosk** | 3200 | show a frame to an audience |
| **Settings** | — | solver, catalogues, reading source, offline data |

Each also starts on its own — `./quickastrolens studio [port]`,
`atlas [port]`, `kiosk` — and `Ctrl+C` on the navigation page stops all of them.

## 5. Settings

The navigation page's **Settings** writes `~/.astrolens/config.json`. One global
set of choices — there are no profiles to switch between:

| section | what it decides |
|---|---|
| **Plate solving** | local or nova, caching, position hints |
| **Catalogues** | online services or the offline pack, and the answer snapshot |
| **Reading** | which tool writes the text: the LLM, or the curated library |
| **Kiosk** | how a frame is presented to a room — label count, idle reset |

What separates the studio from the kiosk is not settings but *what the two
programs do*: a kiosk shows pre-written readings because that is what a kiosk
is, and it works with the network unplugged. Neither is a preference.

> **`.env` still wins.** Anything set there overrides the settings page, so a
> value saved in the UI can appear not to take effect. The page says so, but it
> is the one gotcha worth remembering.

## 6. Offline data (only for field use)

Everything except plate-solve indexes is small:

| | size | needed offline |
|---|---|---|
| star tables (8 catalogues) | 724 KB | yes |
| OpenNGC | 3.7 MB | yes |
| atlas + registry + readings | ~150 KB | yes |
| plate-solve indexes | 220 MB – 4.9 GB | yes (§3B) |
| reference images (`refimg/`) | ~1 GB | **no** — curation only, gitignored |

```bash
./quickastrolens prefetch          # star tables, ~4.5 MB
./quickastrolens prefetch check    # what is on disk, and whether you can unplug
```

See [ONSITE.md](ONSITE.md) for the full before-you-leave checklist.

## 7. Without a browser (CLI)

```bash
./quickastrolens identify <image> ["Object Name"]      # solve + catalogue → factsheet.json
./quickastrolens read <image> ["Object Name"] [zh|en]  # identify + AI reading + render
./quickastrolens render <reading.json> [annotated|embed|poster|all]
./quickastrolens edit <reading.json> [port]
./quickastrolens kiosk <image> ["Object Name"]         # one fullscreen frame
./quickastrolens readings                              # predefined-reading coverage
./quickastrolens help
```

## 8. Image formats

| | JPG / PNG / TIFF | FITS |
|---|---|---|
| Kiosk (`kiosk`, `kiosk-serve`, `kiosk-watch`) | yes | **yes** — decoded and auto-stretched |
| Studio upload | yes | **yes** — same conversion |
| Atlas upload | yes | **yes** — converted server-side |

FITS is decoded in-process (no astropy, no external tool) and given a display
stretch, because a linear master is nearly black and both the solver and the
audience need to see something. In the studio the original file is kept beside
the converted PNG in the project folder. A Bayer-matrix frame from a
one-shot-colour camera is shown as mono and labelled as such rather than guessed
at — feed a stacked master rather than a raw OSC light frame.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Plate-solving needs a nova API key` | no `ASTROMETRY_API_KEY` and not using the local solver — §3 |
| Local solver installed but nothing solves | index files missing, or `add_path` never added to `astrometry.cfg` — §3B |
| `Couldn't find table "kdtree_data_codes"` | that index file downloaded truncated — re-run `prefetch indexes <arcmin>`; it now detects short files and re-fetches them |
| Solve hangs for minutes | nova's shared queue is busy; retry or switch to local (§3B) |
| A setting saved in the UI has no effect | `.env` overrides it — §5 |
| `claude` errors when generating a reading | CLI not installed/authenticated; everything else still works |
| "No baseline annotations for X yet" | that target is not in the atlas — expected. See [CURATING.md](CURATING.md) |
| Export folder picker missing | use Chrome / Edge / Arc, or pick the browser-download option |
| Port already in use | 3000 / 3010 / 3100 / 3200; stop the other instance or pass `--port` |

## 10. Notes for self-deployers

- **No hardcoded storage.** Reference images go through a storage adapter —
  local filesystem by default; an R2/S3 backend is pluggable. Credentials stay
  server-side, never `VITE_`-prefixed.
- **Readers need no storage.** The apply side only reads `registry.json` (sky
  coordinates); it never touches reference images.
- **Plate-solving is replaceable** — nova, local, or your own `SolveClient`
  (`packages/identify/src/solveClient.ts`).
- **Two data layers everywhere.** A shipped baseline plus your own overlay,
  merged at read time, so you extend coverage without touching curated files:
  registry (`~/.astrolens/atlas/registry.json`), predefined readings
  (`~/.astrolens/readings.json`), curator text (`~/.astrolens/content.json`).
