# Curating: annotations, readings, wording

Everything an audience eventually reads comes from three bodies of curated work:
**annotations** (what is outlined on the image), **readings** (what is said about
each target), and **wording** (the fallback text used when nothing specific has
been written). This is how to build and maintain them.

Install first: [SETUP.md](SETUP.md).

---

## The order of work

```
1. annotate          draw features on a reference image
2. draft the text    in the atlas, per target — shapes may still be drafts
3. review both       the shape and its words, in one pass → approved / 已审核
4. export registry   approved-only; this is what everything downstream reads
```

Text is keyed by an annotation id that is stable from the moment a shape is
drawn, so writing before approval is safe and lets one review pass cover the
shape and its words together. A shape dropped later leaves an entry keyed to an
id nothing looks up — harmless.

**Export is last** because it is what the kiosk and studio read at runtime, not
something drafting needs.

One asymmetry worth knowing: the **atlas** drafts from the annotations
themselves, so drafts count. The **command line** (`readings-draft`) reads the
*exported registry*, which contains only approved annotations — so a target with
nothing approved will not appear there. Use the atlas while the work is in
progress; the CLI for a batch afterwards.

---

## 1. Annotate

The atlas is where B-class morphology features (pillars, ionization fronts,
filaments, dust lanes, shells…) come from. You draw them **once** on a reference
image, in sky coordinates; ASTELLUM then projects them onto **any** future image
of that target via that image's WCS. No ML, no image matching — deterministic.

```bash
./astellum atlas          # or the Atlas card on the navigation page
```

A plate-solver is required here too: uploading a reference image solves and
identifies it, so the target's identity is filled in for you.

1. **Upload a reference image** — big images are downscaled in the browser
   first. JPG, PNG and FITS all work; a FITS is sent whole (a browser cannot
   decode one to shrink it) and converted, stretched and capped server-side.
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
| `registry.json` | approved-only export; **this is what ASTELLUM reads** | yes (the shipped artifact) |

Two layers, merged at apply time:

| layer | file | owner |
|---|---|---|
| shipped baseline | `packages/atlas/data/registry.json` (or `$ATLAS_REGISTRY`) | the project |
| your overlay | `~/.astellum/atlas/registry.json` (or `$ATLAS_USER_REGISTRY`) | you, locally |

Predefined readings layer the same way (`readings.json` in each dir), and merge
**field by field**: correcting one sentence keeps the shipped scale line,
cultural note, fun facts and every per-annotation explanation you did not touch.
Pulling a new release never overwrites your wording.

Merged by object identity: your overlay **extends** the baseline — add
annotations to an existing target, or add targets it does not cover — without
touching the shipped file. No merge conflicts.

`./astellum atlas` deliberately points at the **shipped seed**
(`packages/atlas/data`), because this repo's launcher is the curator's entry
point. Extending the atlas for yourself: call the CLI directly
(`node packages/cli/dist/index.js atlas` — not the `./astellum` launcher —
which defaults to `~/.astellum/atlas`) or pass `--data-dir`.

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

**In the atlas**, on the target you have open: the reading editor offers
**AI 起草一份 / Draft with AI** whenever settings has the reading mode set to
the LLM. It uses the approved annotations — including the notes you wrote — as
material, fills the form, and **does not save**: a draft is something to read
and correct, and saving it silently would make the status flag a lie.

From a terminal, for a batch:

```bash
./astellum readings              # who has text, and which elements are missing
./astellum draft "NGC 3372"      # draft one
./astellum draft all             # draft everything still uncovered
```

Drafting needs a network and a logged-in `claude` CLI. Output goes to
`packages/atlas/data/readings.json`, marked `source: "ai_draft"`, and is written
after **each** target so a long batch cannot lose everything to one failure.
Targets that already have text are skipped unless you pass `--force`.

The model is given the annotation ids and may not invent new ones — any it makes
up are dropped rather than saved against nothing.

### Reviewing a draft

**In the atlas tool**, on the target you are already looking at: open an entry,
**Edit canonical**, then **编辑现场解读 / Edit onsite reading** below the save
button. Each approved annotation gets its own slot, so what is still unwritten
is visible rather than inferred, and the panel lists what the reading is missing.
Set the status to *已审核 / reviewed* when a person has stood behind the text.

Which file it writes follows the atlas you opened — the shipped seed for a
curator, your own data dir for a deployment. Editing by hand works too:
`readings.json`, beside `atlas.json`.

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

`featureNotes` covers most of the drawable types — the keys are listed inside the
file. A type with no note falls through to the fact template and is marked ※
onsite, which is a fine place to leave one until you have the words. They are written for the level a visitor actually follows; a test fails if
jargon creeps in.

Deliberately **not** editable this way: the taxonomies (41 feature types, 15
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
caffeinate -s ./astellum atlas
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

…then open the tunnel URL on mobile data and confirm it challenges you.

What you see from outside depends on what is in front of it. With Cloudflare
Access configured, the public URL answers **302** — a redirect to its login —
and the app's own 401 only appears after you are through. Without Access, you
get the 401 directly. Either way, an unchallenged 200 from outside means
something is wrong.

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
