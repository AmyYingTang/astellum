import { z } from 'zod';
import { LocalizedString } from '@astellum/schema';

/**
 * The LLM's tailoring output: bilingual narrative + per-feature bilingual text,
 * keyed by the grounded feature ids. The LLM does not produce identity, color,
 * geometry or feature membership — those come from the FactSheet.
 */
export const LlmTailoring = z.object({
  narrative: LocalizedString,
  features: z.array(
    z.object({
      id: z.string(),
      explanation: LocalizedString,
      physics: LocalizedString.optional(),
      interesting: LocalizedString.optional(),
    }),
  ),
});
export type LlmTailoring = z.infer<typeof LlmTailoring>;

/** Strip markdown fences and any prose around the JSON object. */
export function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1]! : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return candidate.trim();
  }
  return candidate.slice(start, end + 1).trim();
}

export type ParseResult =
  | { ok: true; data: LlmTailoring }
  | { ok: false; error: string };

// Stray C0 control chars (0x00-0x1F) except tab/newline/carriage-return.
const STRAY_CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

/** Best-effort repair of common LLM JSON slips (trailing commas, stray control chars). */
function repairJson(s: string): string {
  return s.replace(/,(\s*[}\]])/g, '$1').replace(STRAY_CONTROL, '');
}

export function parseTailoring(raw: string): ParseResult {
  const candidate = extractJson(raw);
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    try {
      json = JSON.parse(repairJson(candidate));
    } catch (e) {
      return { ok: false, error: `JSON.parse failed: ${(e as Error).message}` };
    }
  }
  const result = LlmTailoring.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.toString() };
  }
  return { ok: true, data: result.data };
}
