# Curating: annotations, readings, wording

Everything an audience eventually reads comes from three bodies of curated work:
**annotations** (what is outlined on the image), **readings** (what is said about
each target), and **wording** (the fallback text used when nothing specific has
been written). This is how to build and maintain them.

Install first: [SETUP.md](SETUP.md).

---

## The order matters

Do it in this order. Drafting readings before the annotations are approved
wastes a whole pass:

```
1. annotate          draw features on a reference image
2. review + approve  draft → in review → approved
3. export registry   approved-only; this is what everything downstream reads
4. draft readings    AI writes a first pass, per target
5. review the text   ai_draft → human
```

**Why 4 must come after 3.** The drafter reads the *exported registry*, and the
registry contains only objects with at least one approved annotation. Two
consequences:

- A target with nothing approved does not appear at all — `readings` will not
  list it and `draft` cannot write for it.
- The prompt feeds the model each annotation's id, type, label and your note,
  and asks for a line per annotation. With no annotations it can only produce
  the narrative, scale, culture and fun-facts — and the per-feature lines are
  exactly what a visitor sees when they tap a label.

Drafting early means re-running later with `--force`.

---

## 1. Annotate

The atlas is where B-class morphology features (pillars, ionization fronts,
filaments, dust lanes, shells…) come from. You draw them **once** on a reference
image, in sky coordinates; astrolens then projects them onto **any** future image
of that target via that image's WCS. No ML, no image matching — deterministic.

```bash
./quickastrolens atlas          # or the Atlas card on the navigation page
```

A plate-solver is required here too: uploading a reference image solves and
identifies it, so the target's identity is filled in for you.

1. **Upload a reference image** — big images are downscaled in the browser
   first. JPG/PNG only here; the studio and kiosk take FITS, the atlas does not
   yet.
2. **Draw** — pick a feature type, optionally give the feature a proper name
   ("Mystic Mountain"), **Start drawing**, click the outline point by point,
   **Finish & save this shape**. When not drawing, drag to pan and scroll to
   zoom. Rough outlines are the intent — readers interpret them.
3. **Write the note** *(optional but valuable)* — each annotation can carry a
   bilingual note. It is the second fallback layer at showtime, and it is fed to
   the drafter as context, so a sentence here improves the AI pass later.
4. **Review** — set each annotation's status: *draft* → *in review* →
   *approved*. Approving stamps `reviewed_by` from the top-bar **current user**
   field, so set that to your own name.
5. **Save to atlas**, then **Export registry (approved only)**.

Re-open an entry from **In the atlas** for a read-only preview; **Edit
canonical** to change it, or **Verify on another image** to load a different
photo of the same target and check the annotations still land correctly.

### Where the data lives

| File | What | In git? |
|---|---|---|
| `atlas.json` | annotations + review status + each entry's reference WCS | yes (small, text) |
| `refimg/` | the reference images | **no** (gitignored — large binaries) |
| `registry.json` | approved-only export; **this is what astrolens reads** | yes (the shipped artifact) |

Two layers, merged at apply time:

| layer | file | owner |
|---|---|---|
| shipped baseline | `packages/atlas/data/registry.json` (or `$ATLAS_REGISTRY`) | the project |
| your overlay | `~/.astrolens/atlas/registry.json` (or `$ATLAS_USER_REGISTRY`) | you, locally |

Merged by object identity: your overlay **extends** the baseline — add
annotations to an existing target, or add targets it does not cover — without
touching the shipped file. No merge conflicts.

`./quickastrolens atlas` deliberately points at the **shipped seed**
(`packages/atlas/data`), because this repo's launcher is the curator's entry
point. Extending the atlas for yourself: use the bare CLI (`astrolens atlas`,
which defaults to `~/.astrolens/atlas`) or pass `--data-dir`.

> **Re-export after upgrading.** Registries exported before annotation ids were
> carried through do not have them, and predefined reading text attaches to those
> ids. If per-target text is not appearing, re-export.

---

## 2. Write the readings

A *predefined reading* is what the kiosk shows when there is no network and no
LLM. It is looked up in four layers, in order, and the kiosk marks anything that
came from the last two so nothing generic is passed off as specific:

| layer | source | scope |
|---|---|---|
| 1. target | `readings.json` for this object, in the chosen style | this target |
| 2. annotation note | the note you wrote in the atlas | this annotation |
| 3. generic note | `content.json` → `featureNotes` | all objects of that type |
| 4. facts | built at render time from the fact sheet | anything |

### Coverage, then drafting

```bash
./quickastrolens readings              # who has text, and which elements are missing
./quickastrolens draft "NGC 3372"      # draft one
./quickastrolens draft all             # draft everything still uncovered
```

Drafting needs a network and a logged-in `claude` CLI. Output goes to
`packages/atlas/data/readings.json`, marked `source: "ai_draft"`, and is written
after **each** target so a long batch cannot lose everything to one failure.
Targets that already have text are skipped unless you pass `--force`.

The model is given the annotation ids and may not invent new ones — any it makes
up are dropped rather than saved against nothing.

### Reviewing a draft

Read it, fix it, then change `source` to `"human"`. Nothing enforces this; it is
how you tell later which text a person has actually stood behind. The coverage
report shows `~` for drafts and `✓` for reviewed.

Each reading should cover five things — the standard the whole library is
written against, and itself editable (§3):

1. what it is and where it sits
2. **a sense of scale — above all, inside or outside the Milky Way**
3. the features worth looking at in this image
4. cultural connections: naming, myth, history
5. fun facts

### The other direction

A reading you like in the studio can become the predefined entry for that
target: **Save as predefined reading** in the editor attaches the text to the
annotation ids and marks it `ai_approved`. Ordinary studio work then fills the
offline library as a side effect, instead of it only ever growing by hand.

---

## 3. Wording you can change without rebuilding

`packages/atlas/data/content.json` — edit, save, done. No build step. Any
section you omit falls back to the built-in value, so an empty file is valid and
there is nothing to migrate.

| section | what it is |
|---|---|
| `featureNotes` | the plain-language note per structure type — layer 3 above |
| `nicknames` | names that exist only in observing apps and the community |
| `stylePresets` | the quick-pick buttons beside the studio's prompt |
| `readingBrief` | who the writing is for, and what a reading must cover |

`readingBrief` is the one to reach for first: it is the standard both the drafter
and the studio's AI pass are held to, so changing it changes everything written
afterwards.

`featureNotes` covers the eleven drawable types — the keys are listed inside the
file. They are written for the level a visitor actually follows; a test fails if
jargon creeps in.

Deliberately **not** editable this way: the taxonomies (39 feature types, 11
drawing types, 64 otype labels), the palette, and UI strings. Those are coupled
to enums and colour mappings, and turning them into data would trade a compile
error for a runtime one.

---

## 4. Two people, one instance

- Each person sets the top-bar **current user** to their own name so `author`
  and `reviewed_by` are truthful.
- Saves are serialized and each entry carries a revision. Saving an entry that
  changed since you loaded it is **rejected** with a "reload before saving"
  message rather than silently overwriting. If you see it: reload, redo.
- Only whoever runs the host needs git; the data lives on that machine, so they
  commit `atlas.json` / `registry.json` / `readings.json` when checkpointing.
- There is no in-tool commenting — discuss elsewhere; the tool carries status
  and who approved.

### Hosting it for a reviewer

If a collaborator should review but will not install anything, host the tool and
send a URL. They then need no git, no reference images and no plate-solver.

```bash
# .env (gitignored)
ATLAS_PASSWORD=pick-something-long
```

```bash
caffeinate -s ./quickastrolens atlas
```

- **`ATLAS_PASSWORD`** puts HTTP Basic auth over the whole tool — pages, API and
  reference images. **Set it before exposing anything.** Any username.
- **`caffeinate -s`** stops the machine sleeping while the server runs. Locking
  the screen is fine; a *system* sleep kills the server and the tunnel.

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3100    # prints an https://…trycloudflare.com URL
```

That URL changes on every restart. For a stable address plus email-based access
control, use a named tunnel on your own domain and add Cloudflare Access.

> ⚠️ **Expose port 3100 only.** The atlas is the only surface with
> authentication. The navigation page, studio and kiosk have none — and the
> navigation page's settings can rewrite the machine's configuration. Its cards
> also link to `localhost`, so it would not work through a tunnel anyway.

Before sending the link:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/   # expect 401
pmset -g assertions | grep -i caffeinate                          # expect a match
```

…then open the tunnel URL on mobile data and confirm it prompts for a password.

---

## 5. Contributing back

Coverage is the point, so contributions are welcome. Open a PR adding your
approved entries to `packages/atlas/data/registry.json` (and reference images if
useful). Maintainers review and merge; your targets ship to everyone next
release.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Shapes render but the image is blank | the reference image is missing from `refimg/` (gitignored, so it does not travel with a clone) — host one instance, or copy the folder |
| "Save to atlas" stays greyed out | the **primary ID** is required |
| "Someone else changed this entry" | expected concurrency guard — reload and redo |
| Upload fails / "could not decode image" | the atlas takes JPG/PNG only; FITS works in the kiosk path |
| Annotations do not show on a user's image | only **approved** ones are exported; re-run **Export registry** |
| Per-target reading text is ignored | the registry was exported before annotation ids were carried — re-export |
| `draft` says a target is not annotated | it has no approved annotations, so it is not in the registry — approve and re-export first |
