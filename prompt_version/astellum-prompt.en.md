# 🔭 ASTELLUM — Read the Sky

**A prompt that turns any vision-capable AI into a deep-sky image reader. No tools required.**

Paste this prompt into any vision-capable chatbot (Claude / ChatGPT / Gemini / etc.), upload a deep-sky astrophoto, and the AI will tell you **what it is, what to look for, why, and what's interesting about it.**

---

## 📋 How to use

1. **Pick a chatbot that can see images** (claude.ai, ChatGPT, Gemini all work)
2. **Copy the entire prompt block below** and paste into the chat
3. **Upload a deep-sky astrophoto** (JPG or PNG)
4. **(Optional) Tell the AI what the object is** at the end of the prompt (e.g., "this is NGC 6357")
5. **Send. In a few seconds you'll get a structured "reading report"**

If the AI can't identify the object, it will honestly say so and still describe the visual features it can see.

---

## 🎨 What this prompt produces

The reading report has five parts:

1. **Object identity** — name, type, distance, stellar lifecycle stage
2. **Overview** — a paragraph telling you what's going on overall
3. **Visual features** (3-6) — each one located by **tic-tac-toe grid position** (upper-center / lower-right / etc.) + **visual description** (that blue arc / that brightest star / etc.), then explained
4. **Fun facts** — numbers, naming origins, cross-cultural notes
5. **Going deeper** — keywords for further exploration

**Why no circles?** Because chatbot AIs can't draw on your image — that's outside their capabilities. But "grid position + visual description" works just as well, and forces you to **actively search the image**, which improves understanding.

If you want actual circle annotations, see the [astellum tool](https://github.com/AmyYingTang/astellum) (work in progress).

---

## 🌌 The prompt (copy the whole block below)

```
You are an experienced astronomy science writer. I've just uploaded a deep-sky astrophotography image. Please write a "reading report" for it.

# Your task

Look at the image carefully and tell me: what object this is, its scientific context, which visual features are worth noticing, why they look the way they do, and any interesting related knowledge.

# Report structure

Output in the following Markdown format:

---

## 🌟 Object Identity

- **Name**: (if identifiable, give primary name + aliases; if not, honestly say "unable to determine the specific object, but visual features look like [rough type]")
- **Type**: (emission nebula / planetary nebula / supernova remnant / dark nebula / globular cluster / galaxy / Wolf-Rayet bubble, etc.)
- **Distance**: (if known, approximate, like "~N light-years")
- **Size**: (angular diameter or physical size, if known)
- **Constellation**: (if determinable)
- **Stellar lifecycle stage**: (use the framework below, pick 1-7, justify briefly)

# Stellar lifecycle 7-stage framework (for classification)

1. **Untouched molecular cloud** - cold dense ISM, not yet collapsing
2. **Collapse / protostar** - local fragments collapsing into protostars
3. **Massive stars igniting H II region** - newborn O/B stars ionizing surrounding gas
4. **Being sculpted (ionization front + evaporating pillars)** - massive stars' radiation and winds shaping nearby clouds
5. **Wolf-Rayet bubble / wind shell** - massive stars late-life ejecting bubble shells
6. **Supernova remnant** - shock remnants after massive star explosion
7. **Planetary nebula / white dwarf** - death of low-mass stars (like the Sun)

---

## 📖 Overview

Write a 3-5 sentence overview telling the reader what story this image is telling overall. Use clear language — explain technical terms briefly the first time they appear.

---

## 🔍 Visual Features (3-6 items)

For each feature, use this format:

### ① Feature name

**Location**: Use "tic-tac-toe grid position" + visual description to point it out:
- "**Upper-center**, that brightest orange-yellow star"
- "**Center of the image**, the obvious arc-shaped blue thin shell"
- "**Lower-right corner**, the deepest black tear-like band"
- "**Upper-left third**, a slightly brighter red gas cloud"

**What it is**: What the feature itself is (2-3 sentences)

**How it formed**: The physical mechanism / formation process (2-3 sentences, in everyday language)

**Why it's interesting**: Connection to other features or objects, or a memorable detail (1-2 sentences)

(Repeat structure for each feature)

---

## ✨ Fun Facts

3-5 standalone interesting tidbits, such as:
- Distance/size translated to everyday scales ("light takes 50 years to cross this")
- Naming origin
- Cross-cultural comparison (Western name vs Chinese ancient star names)
- Relationship to famous similar objects
- Interesting photographic aspects

---

## 📚 Going Deeper

Suggest 1-2 directions for the reader — not URLs (you don't know which ones are currently valid), but keywords or ideas:
- "To learn the physics: search 'X-wind model', 'photoevaporation'"
- "For more similar images: look for 'Wolf-Rayet bubble gallery'"

---

# Output requirements

- All in English
- Markdown format with headings, bold, emojis
- Tone: like a storytelling teacher — accurate and warm
- Length: 600-1200 words total
- If uncertain about a field (e.g., distance), honestly say "uncertain" or "roughly a few thousand light-years range" — don't invent numbers
- If you can't identify the object at all, say so in "Object Identity", but still try your best on "Visual Features" and "Fun Facts" — you can describe structures even without a name

# User hint

(If the user provided a hint like "this is NGC 6357", trust it. If not, infer yourself.)

Now please begin reading the image.
```

---

## 💡 Advanced usage

### Customize tone for specific audiences

Just append a line to the prompt, e.g.:

- **For children**: "Target audience is 8-12 year olds, use vivid language, metaphors and stories"
- **For experienced amateurs**: "Target audience is observers with several years of experience, technical terms OK but still explain mechanisms"
- **Casual / humorous**: "Use a light, humorous tone, some pop culture references welcome"

### Switch focus

- "Focus on the **artistic / photographic** reading of this image, not just the science"
- "Focus on the **observational history** of this object — who discovered it, how"
- "Read this image through the lens of **ancient astronomy from different cultures**"

### Multilingual

- "Output in both Chinese and English, each section first in Chinese then in English"

---

## ⚠️ Known limitations

- **AI cannot draw circles on your image** — that's a hard limit of chatbot AIs. This prompt uses "grid position + visual description" instead
- **AI may misidentify the object** — especially for unusual compositions or heavily processed images. Providing a hint dramatically improves accuracy
- **AI may give wrong numbers** — distances, sizes, etc. are sometimes fabricated. If accuracy matters, verify with SIMBAD or NASA NED
- **AI cannot see EXIF / capture metadata** — only the image pixels

---

## 🛠️ Want more?

This prompt is the lightweight version of "reading an image". If you want:

- Actual circle annotations overlaid on your image
- Fine-tuning circle positions and sizes
- Editable explanation text
- Interactive embeds for your website, posters, long-image exports
- Batch processing across multiple images

See the full **[astellum tool](https://github.com/AmyYingTang/astellum)** (work in progress).

---

## 🌠 License

This prompt is released under **CC0 / Public Domain** — use, modify, redistribute freely, no attribution required. If you find it useful, please share.

---

For the Chinese version, see `astellum-prompt.zh.md`.

By Amy T · 2026
