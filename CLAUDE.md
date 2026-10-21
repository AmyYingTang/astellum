# ASTELLUM — working notes

*Astronomical Structure Tagging, Explanation and Level-adaptive Learning for
Understanding Morphology.* Renamed from **astrolens** in 2026-09 (name clash).
Env vars, `~/.astellum` and the other local paths were cut over with no
fallback; the one exception is `generator.tool` — old `"astrolens"` readings
still parse and come back as `"astellum"`.

An interactive astronomical image reader. Upload a deep-sky photo, get a
structured, bilingual reading anchored to specific spots on the image — either
as a poster you craft, or as a fullscreen page an audience touches.

User-facing docs live in `docs/`: **SETUP.md** (install), **CURATING.md**
(annotate → review → write), **ONSITE.md** (running it at an event). This file
is the short version of *why things are the way they are*, so a change doesn't
undo a decision.

## The four surfaces

`./astellum` opens a navigation page; each also starts on its own.

| | port | what it is |
|---|---|---|
| hub | 3000 | navigation + settings |
| studio | 3010 | make a frame: identify → adjust → AI reading → export |
| atlas | 3100 | draw and review baseline annotations; edit predefined readings |
| kiosk | 3200 | pick a file, show a fullscreen page to an audience |

`./astellum` is the **curator** entry point: it points the atlas and the
readings library at the shipped seed (`packages/atlas/data/`). The CLI called
directly (`node packages/cli/dist/index.js atlas`) defaults to `~/.astellum/` —
a deployment's own layer. The launcher and the CLI's `bin` are both named
`astellum`; the `./` is the difference.

## Invariants — do not quietly break these

- **Identity is never fabricated.** If nothing is identified, no page is
  produced. The LLM writes prose only; it never supplies identity, geometry or
  colour. Anything it invents an id for is dropped.
- **Two classes of feature.** A-class comes from a catalogue query after a
  plate-solve. B-class comes *only* from the human-approved atlas, projected by
  WCS. The old auto-detectors (CV / geometric / VLM) are disconnected from the
  fact sheet — don't reconnect them without a decision.
- **The kiosk reads, it does not write.** By default — `kiosk.readingSource`
  turns it into writing on the night for the audience in front of you, which
  costs a network and tens of seconds, and is why the default is the other way.
  Even then the model only rewrites prose: identity, geometry and colour still
  come from the identification, and an unreachable model falls back to the
  library rather than losing the frame.
- **Bilingual everywhere.** Every user-facing string, feature name and
  explanation ships zh + en. UI language starts from the browser locale
  (`preferredLang`) and is remembered.
- **宁缺毋滥 onsite.** A kiosk shows few confident labels. Precision over
  recall; a missing label beats a wrong one.
- **`.env` outranks the settings page.** Env overrides are applied last, on
  purpose, so existing recipes keep working. The settings page says so.

## Two ideas that shape most of the code

**Layering.** Everything curated exists twice: a shipped baseline and a
deployment's own overlay, merged at read time — the registry, predefined
readings, curator text. An overlay **extends** the baseline and never edits it,
so pulling a release cannot overwrite someone's wording. Reading overlays merge
*field by field* (and per-annotation by id): correcting one sentence must not
drop everything else.

**Settings are global and flat.** There are no profiles. What separates the
studio from the kiosk is not configuration but what those programs *do* — a
kiosk shows pre-written readings because that is what a kiosk is. Config holds
only genuine machine-level preferences: `solve`, `catalog`, `atlas`, `reading`,
`kiosk`.

## Where the text comes from

The kiosk resolves each label through four layers, in order, and marks anything
from the last two so nothing generic is passed off as specific:

1. `readings.json` — this target, this style
2. the annotation's own note in the atlas
3. `content.json` → `featureNotes` — by drawable type (11 of the 15 have one)
4. a template built from grounded facts

**Editable as data** (`packages/atlas/data/content.json`, no rebuild):
`featureNotes`, `nicknames`, `stylePresets`, `readingBrief`. Omit a section to
keep the built-in; an empty section means "not specified", not "make it empty".

**Deliberately still code:** the taxonomies (41 feature types, 15 drawing types,
64 otype labels), the palette, UI strings. They are coupled to enums and colour
mappings — data-ifying them trades a compile error for a runtime one.

## Order of work that matters

Annotate → draft the text → review shape and words **together** → export.

Export is a separate step because it is what the runtime reads, and that is
also the one thing a curator forgets — so the atlas compares the two files and
says which targets are behind, and the save step on the right exports as it
saves. Nothing exports by itself: the registry is a tracked file, and it should
only change when somebody meant it to.

Text is keyed by an annotation id that is stable from the moment a shape is
drawn, so writing before approval is safe and keeps review to one pass. Export
is last because it is what the runtime reads, not what drafting needs.

The two drafting paths differ on purpose: the **atlas** drafts from the
annotations themselves (drafts included), the **CLI** from the exported registry
(approved only). In-progress work uses the former.

## Commands

```bash
pnpm build          # tsc + all three clients (editor, atlas, viewer)
pnpm test           # vitest, 232 tests
pnpm lint           # eslint
./astellum help
```

`pnpm build` must include **every** client — it silently omitted the atlas one
for a while, so interface changes there appeared not to take effect.

## Known gaps

- `readings-draft` has never been run against a live model here; only mocked
  runners are tested. (The `claude` CLI *is* logged in now — the kiosk's online
  path was run end to end on 2026-10-21, 89 s for one Carina frame — so this
  gap is about that command, not about the machine.)
- The kiosk page has not been tried on a real touchscreen, and the idle reset
  has not been observed firing.
- No genuine network-unplugged rehearsal yet.
- The atlas upload takes JPG/PNG only; the studio and kiosk take FITS.
- One pre-existing lint error: `react-hooks/exhaustive-deps` rule not installed.
