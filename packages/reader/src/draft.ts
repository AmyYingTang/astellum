import {
  DEFAULT_STYLE,
  PredefinedStyle,
  type LocalizedString,
  type PredefinedReading,
  contentOverlay,
  type RegistryEntry,
} from '@astrolens/schema';
import { runClaude, type RunClaudeOptions } from './claudeCli.js';
import { extractJson } from './parseJson.js';

/**
 * Draft a target's predefined reading with the LLM, offsite, so a human only has
 * to review rather than write from scratch.
 *
 * The arithmetic is the point: 64 targets, each with a narrative, a scale line,
 * a cultural note, fun facts and a line per annotation, is a lot of writing.
 * Drafting is the one job an LLM is unambiguously good at here — and the output
 * lands in the same review queue as everything else, marked `ai_draft` until a
 * person promotes it.
 *
 * Nothing here reaches an audience unreviewed: `source` stays `ai_draft`, and
 * the kiosk shows what layer each line came from.
 */

/** School year 8–12. Overridable: who the writing is for is a curator's call,
 *  not a constant. */
const DEFAULT_STYLE_BRIEF = `写给 8–12 年级(约 13–18 岁)的读者:句子短、不堆术语、
凡是专有名词都顺带解释一句。这个程度对成年人科普也刚好够用。
不要使用「令人叹为观止」这类空话,宁可少写也不要写空。`;

const DEFAULT_ELEMENTS = [
  'property_and_position —— 这是什么、在哪个星座',
  'sense_of_scale —— 尤其说清在银河系**之内**还是**之外**,以及距离和大小',
  'important_features —— 逐条标注各写一句(见下面的清单)',
  'culture —— 命名来源、神话、观测史',
  'fun_facts —— 有趣的冷知识,1–2 条',
];

const styleBrief = (): string =>
  contentOverlay().readingBrief?.styleBrief ?? DEFAULT_STYLE_BRIEF;
const elements = (): string =>
  (contentOverlay().readingBrief?.elements ?? DEFAULT_ELEMENTS)
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');

function shapeFor(annotationIds: readonly string[]): string {
  return `{
  "narrative": { "zh": string, "en": string },
  "scale":     { "zh": string, "en": string },
  "culture":   { "zh": string, "en": string },
  "fun_facts": [ { "zh": string, "en": string } ],
  "features": [
${annotationIds.map((id) => `    { "annotation_id": "${id}", "explanation": { "zh": string, "en": string } }`).join(',\n')}
  ]
}`;
}

export interface DraftOptions {
  style?: string;
  model?: string;
  runner?: (o: RunClaudeOptions) => Promise<string>;
}

/**
 * Build the drafting prompt for one registry entry. Exported so it can be
 * inspected and tested without spending a model call.
 */
export function buildDraftPrompt(entry: RegistryEntry, style: string): string {
  const anns = entry.annotations.filter((a) => a.id);
  const list =
    anns
      .map((a) => {
        const label = a.label.zh || a.label.en || a.feature_type;
        const note = a.note?.zh || a.note?.en;
        return `  - annotation_id=${a.id}  类型=${a.feature_type}  标签=${label}${note ? `  策展人备注:${note}` : ''}`;
      })
      .join('\n') || '  (这个目标还没有已批准的标注)';

  return `你是一位天文科普作者。请为下面这个天体写一份**预先录入**的解读,供现场(无网络、无 AI)展示使用。

天体:${entry.primary_id}${entry.aliases.length ? `(别名:${entry.aliases.join('、')})` : ''}
风格档位:${style}

${styleBrief()}

内容必须覆盖以下几点:
${elements()}

这张图上已经人工标注、需要逐条配文的结构:
${list}

只输出一个严格符合下方结构的**合法 JSON**,不要 markdown 围栏,不要任何前后说明。
字符串里的双引号和换行必须转义。中英各一份,语义对应而非逐字直译:
${shapeFor(anns.map((a) => a.id!))}

要求:
1. features 里的 annotation_id 必须与上面给出的完全一致,不增不删。
2. 每条 explanation 2–3 句,写这条标注**本身**是什么、为什么长这样。
3. 不确定的事实宁可不写,绝不编造距离、尺寸或发现史。
4. scale 一定要明确说出「在银河系内」还是「在银河系外」。`;
}

/** Draft one entry. Returns the parsed style block, or throws with the raw text. */
export async function draftPredefinedStyle(
  entry: RegistryEntry,
  opts: DraftOptions = {},
): Promise<PredefinedStyle> {
  const style = opts.style ?? DEFAULT_STYLE;
  const runner = opts.runner ?? runClaude;
  const raw = await runner({ prompt: buildDraftPrompt(entry, style), model: opts.model });
  const json = extractJson(raw);
  if (!json) throw new Error(`Could not find JSON in the model output for ${entry.primary_id}`);
  const parsed = PredefinedStyle.safeParse(JSON.parse(json));
  if (!parsed.success) {
    throw new Error(
      `Draft for ${entry.primary_id} did not match the schema: ${parsed.error.issues[0]?.message}`,
    );
  }
  // Drop any feature the model invented an id for — the annotation set is fixed.
  const known = new Set(entry.annotations.map((a) => a.id).filter(Boolean));
  return {
    ...parsed.data,
    features: parsed.data.features.filter((f) => known.has(f.annotation_id)),
  };
}

/** Wrap a drafted style into a library entry, marked as an unreviewed draft. */
export function draftToEntry(
  entry: RegistryEntry,
  style: string,
  drafted: PredefinedStyle,
  now: string,
): PredefinedReading {
  return {
    schema_version: 1,
    primary_id: entry.primary_id,
    aliases: [...entry.aliases],
    styles: { [style]: drafted },
    source: 'ai_draft',
    updated_at: now,
  };
}

/** Rough completeness signal for a review queue: how much is actually written. */
export function draftWordCount(style: PredefinedStyle): number {
  const parts: (LocalizedString | undefined)[] = [
    style.narrative,
    style.scale,
    style.culture,
    ...style.fun_facts,
    ...style.features.map((f) => f.explanation),
  ];
  return parts.reduce((n, p) => n + (p ? p.zh.length + p.en.split(/\s+/).length : 0), 0);
}
