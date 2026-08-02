# Running it onsite

The kiosk is the show-it-to-people half of astrolens: an image goes in, a
fullscreen page comes out that visitors touch to find out what they are looking
at. It is built to work with the network unplugged, and to be operable at arm's
length in the dark by someone who is also answering questions.

Install first: [SETUP.md](SETUP.md). Content comes from
[CURATING.md](CURATING.md).

---

## Before you leave

Everything here needs a network. None of it does afterwards.

```bash
./quickastrolens prefetch                 # star tables, ~4.5 MB
./quickastrolens prefetch indexes 64      # plate-solve indexes — pick your field size
./quickastrolens prefetch targets         # snapshot online answers for annotated targets
./quickastrolens prefetch check           # confirm, and it says whether you can unplug
```

`prefetch targets` is the optional one, and worth explaining. The star tables
identify the target on their own; the snapshot replays what SIMBAD and VizieR
said about the *same patch of sky*, which is where faint companions and Chinese
names come from. It only covers targets that have approved annotations, since
that is what it locates them by.

Then actually pull the cable and run one frame. A dark field is a bad place to
discover a missing table.

```bash
./quickastrolens kiosk some-image.jpg "M 42"
```

## Three ways to run it

**A front door** — the usual one. A page to pick a file from, nothing else:

```bash
./quickastrolens kiosk            # → http://localhost:3200
```

**One shot** — for a script, or another program driving astrolens. It opens the
finished page in a browser when it is done (`--no-open` to suppress):

```bash
./quickastrolens kiosk image.fit "NGC 3372"
```

**Watching a folder** — for a stacker that writes its output to disk:

```bash
./quickastrolens watch ~/stacks
```

It waits for the file to stop growing before touching it, guesses the target
from the filename (`M42_300s_stack.tif` → `M42`), and handles one image at a
time. A failure logs and waits for the next file rather than ending the night.

All three take FITS and stretch it automatically, JPG, PNG and TIFF.

## Name the target if you can

The single biggest thing you can do for reliability. Onsite you already know
what you shot, and that is better evidence than a cone search:

- it skips the rule that an object's catalogue centre must fall inside the
  frame — which is exactly what fails on a tight crop of a sub-structure, or a
  frame inside something enormous;
- it survives the prominence filter, which otherwise drops targets that have no
  catalogued size;
- it is matched against the atlas's aliases too, so the name curators use works
  even when no catalogue knows it.

Measured on the 64 annotated targets, offline: 60 identified as the primary
object, 4 more present in the list, none missed. Without a target name several
of those fail — and they fail against SIMBAD online for the same reason, so it
is not something more catalogues would fix.

A FITS header's `OBJECT` is used automatically when you do not pass a name.

## What a visitor sees

A fixed two-pane layout — picture on one side, words on the other — that does
not move when something is tapped. Every label has an oversized invisible touch
area, a prompt invites the first touch, and the panel returns to the
introduction after a couple of minutes untouched so the next person starts from
the top. Both languages are in the page, so switching is instant offline.

Drag the divider to give the picture or the text more room; a widefield and a
small planetary want different balances.

## What you see

The kiosk never puts an error in front of an audience. It always shows the
picture and whatever is genuinely known, and reports the rest quietly:

| state | meaning |
|---|---|
| *(nothing)* | solved, target in the atlas, text written |
| `generic_only` | drawn, but no reading written for this target yet |
| `no_annotations` | identified, but nothing has been annotated for it |
| `unsolved` | plate solve failed — the picture is shown, no identity is claimed |

Anything less than complete puts a small **i** in the corner of the picture.
Tapping it explains the state and what the `※` marks mean. It is hidden by
default and absent entirely when everything is fine — none of it is for the
audience.

The terminal is the operator's side: it prints which layer wrote each line
(`target` / `note` / `generic` / `facts`) and what was dropped and why, so
"why isn't that labelled" has an answer.

## Style switching

The kiosk profile allows switching the reading style live, so a schools group
and a public session can get different wording from the same library. Only
styles that exist in `readings.json` appear.

## If something goes wrong

| Symptom | What it means |
|---|---|
| "offline catalog pack incomplete" at startup | run `prefetch` — it names the missing tables |
| Solve takes far longer than at home | the target name was not given, so it is searching blind — pass it |
| Everything reads as a general note | no predefined reading for this target; see [CURATING.md](CURATING.md) §2 |
| `snapshot has nothing covering this field` | expected unless you ran `prefetch targets` for that target; the star tables still work |
| Nothing identified at all | it says so and produces no page — identity is never fabricated. Check the solve first |
| A Bayer FITS looks grey and odd | one-shot-colour raw frames are shown as mono, not demosaiced. Feed a stacked master instead |
