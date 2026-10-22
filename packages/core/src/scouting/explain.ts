import { z } from "zod/v4";
import { llm } from "../llm/client.js";
import { FIT_LABELS, type FitParts } from "./types.js";

export interface ExplainInput {
  creator_id: string; handle: string; platform: string | null; fit: number; parts: FitParts;
  followers: number | null; er: number | null; targetAudiencePct: number | null;
  verdicts: Array<{ requirement: string; verdict: string; reason: string; values: unknown[] }>;
  evidence: Array<{ predicate: string; value: unknown; quote: string | null; date: string | null }>;
  categories: string[];
}
export interface Explanation { creator_id: string; summary: string; pros: string[]; cons: string[] }

const Out = z.object({ items: z.array(z.object({ creator_id: z.string(), summary: z.string(), pros: z.array(z.string()), cons: z.array(z.string()) })) });

const SYSTEM = `Escribes, en inglés, la explicación de por qué una creadora encaja (o no del todo) con un brief, para un panel de una agencia.
Solo puedes usar los datos y evidencias que te doy; no inventes cifras ni hechos. Formato por creadora:
- summary: una frase de máximo 22 palabras.
- pros: 2 o 3 frases cortas, concretas, con cifras cuando existan ("64% of her audience is 18–24").
- cons: 1 o 2 frases cortas; si no hay nada relevante, una lista vacía.
Responde solo el JSON pedido.`;

export async function explainResults(items: ExplainInput[]): Promise<Explanation[]> {
  const client = llm("reasoning");
  if (!client || !items.length) return items.map(fallback);
  const out: Explanation[] = [];
  for (let i = 0; i < items.length; i += 8) {
    const batch = items.slice(i, i + 8);
    try {
      const res = await client.complete({ system: SYSTEM, user: JSON.stringify(batch.map(compact)), schema: Out, schemaName: "explanations", maxTokens: 8000 });
      const byId = new Map(res.data.items.map((x) => [x.creator_id, x]));
      for (const it of batch) out.push(byId.get(it.creator_id) ?? fallback(it));
    } catch (e) {
      console.warn(`[explain] fallo del LLM, uso texto determinista: ${e instanceof Error ? e.message : e}`);
      for (const it of batch) out.push(fallback(it));
    }
  }
  return out;
}

function compact(i: ExplainInput) {
  return { creator_id: i.creator_id, handle: i.handle, platform: i.platform, fit: i.fit, parts: i.parts, followers: i.followers, engagement_pct: i.er == null ? null : Number((i.er * 100).toFixed(1)), target_audience_pct: i.targetAudiencePct, categories: i.categories, verdicts: i.verdicts, evidence: i.evidence.slice(0, 12) };
}

export function fallback(i: ExplainInput): Explanation {
  const pros: string[] = []; const cons: string[] = [];
  const parts = Object.entries(i.parts) as Array<[keyof FitParts, number]>;
  for (const [k, v] of parts.sort((a, b) => b[1] - a[1])) {
    if (v >= 85 && pros.length < 3) pros.push(`${FIT_LABELS[k]}: ${v}/100`);
    else if (v < 60 && cons.length < 2) cons.push(`${FIT_LABELS[k]} is weak (${v}/100)`);
  }
  if (i.er != null) pros.push(`Engagement of ${(i.er * 100).toFixed(1)}%`);
  return { creator_id: i.creator_id, summary: `Fit ${i.fit}/100 based on ${parts.length} components.`, pros: pros.slice(0, 3), cons };
}
