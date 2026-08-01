import { FEATURE_TAXONOMY, type FeatureTypeKey } from '@astrolens/schema';

export interface TailorItem {
  id: string;
  name: string; // "zh / en"
  type: string; // English type label
  /** Fine-grained feature type from the taxonomy, when the object is one.
   *  Offsite wants precision, so the model is told the exact classification
   *  (a "wind-blown shell" rather than just "nebula") — the 39-entry taxonomy
   *  is used here, while the kiosk's plain-language notes cover only the 11
   *  drawable types. */
  featureType?: FeatureTypeKey;
}

/** The five things every reading should cover, predefined or AI-written. */
const ELEMENTS = `1. 这是什么、在哪里(类型 + 所在星座/方位)
2. 尺度感 —— 尤其要说清它在银河系**之内**还是**之外**,以及距离/大小
3. 这张图上值得看的结构
4. 文化相关(命名来源、神话、观测史)
5. 有趣的冷知识`;

export interface TailorPromptOptions {
  /** Headline subject (the primary object's display name). */
  headline: string;
  /** The catalogued objects to explain (identity + positions already grounded). */
  items: TailorItem[];
  /** Optional image path; the model may view it to enrich descriptions, not to change identity. */
  imagePath?: string;
  /** Optional tone / audience / focus instructions. */
  tone?: string;
}

const SHAPE = `{
  "narrative": { "zh": string, "en": string },
  "features": [
    { "id": string,
      "explanation": { "zh": string, "en": string },
      "physics"?: { "zh": string, "en": string },
      "interesting"?: { "zh": string, "en": string } }
  ]
}`;

/**
 * Build the tailoring prompt. Identity, the object set and positions are GIVEN
 * (grounded by Stage 1); the model only writes bilingual explanatory text. It
 * must not invent, rename, add or drop objects — "the LLM is bounded by the
 * identification stage". The "features" array is keyed by the given object ids.
 */
export function buildTailorPrompt(opts: TailorPromptOptions): string {
  const lines =
    opts.items
      .map((it) => {
        const t = it.featureType ? FEATURE_TAXONOMY[it.featureType] : undefined;
        // The precise classification, when we have one — it is what lets the
        // model write about *this* structure instead of the generic category.
        const fine = t ? `  [${it.featureType}: ${t.zh} / ${t.en}]` : '';
        return `  - id=${it.id}  ${it.name}  (${it.type})${fine}`;
      })
      .join('\n') || '  (无 / none)';
  const imgLine = opts.imagePath
    ? `\n你可以查看这张图片来丰富描述(但不得据此更改身份或增删条目):${opts.imagePath}\n`
    : '';
  const toneBlock = opts.tone?.trim() ? `\n\n语气 / 受众要求:\n${opts.tone.trim()}` : '';

  return `你是一位天文科普作者。下列天体已由识别系统在视场中确定(plate-solve + 查目录):身份、清单、位置都已接地。你**只**负责为它们撰写**双语(中文 zh + 英文 en)**解读文字,不得更改身份、不得增删或重命名条目。

主题 / 标题:${opts.headline}
(这是用户为这张图定的主题。narrative 要围绕这个主题来组织和立意;若它只是一个天体名,就以该天体为主角。各 feature 的 explanation 仍按其真实身份写。)

需要解读的天体(id 必须原样使用,逐条对应):
${lines}
${imgLine}
只输出一个严格符合下方结构的**合法 JSON**,不要 markdown 围栏,不要任何前后说明。字符串内若出现双引号或换行必须正确转义(\\" 和 \\n);不要在字符串里使用未转义的引号:
${SHAPE}

要求:
1. features 数组中的 id 必须与上面给定的 id 一一对应,不增不删。
2. 每个天体给一条 explanation(2-3 句),中英各一份、语义对应(不是逐字直译)。
3. narrative 是整段导读,**围绕「${opts.headline}」这个主题**把下列天体串成一个画面,中英各一份。
4. narrative 合起来应覆盖这五点:
${ELEMENTS}
5. 方括号里给出的是该结构的精确分类,请据此写出针对它的解读,而不是笼统的类别描述。
6. physics / interesting 可选,有把握再写。
7. 绝不编造身份或位置——这些已由识别系统接地。${toneBlock}`;
}
