import { z } from "zod/v4";
import { llm } from "../llm/client.js";
import { ScoutingFieldsSchema, type FieldSource, type ScoutingFields, type Span } from "./types.js";

/**
 * Paso "Describe" -> "Confirm": convierte el texto libre en campos de negocio.
 * Dos capas: detección determinista (chips de la pantalla Describe) y extracción estructurada con LLM
 * que además devuelve los fragmentos (spans) para la figura "Your description".
 */

import { DETECTORS } from "./detectors.js";
export { DETECTORS, detectChips } from "./detectors.js";

const Extracted = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  product: z.string().nullable(),
  goal: z.enum(["Product launch", "Brand awareness", "Sales and conversions", "UGC content"]).nullable(),
  launch_date: z.string().nullable(),
  creators_wanted: z.number().nullable(),
  platforms: z.array(z.enum(["instagram", "tiktok", "youtube"])),
  followers_min: z.number().nullable(),
  followers_max: z.number().nullable(),
  min_engagement_pct: z.number().nullable(),
  topics: z.array(z.string()),
  location: z.string().nullable(),
  countries: z.array(z.string()),
  age_min: z.number().nullable(),
  age_max: z.number().nullable(),
  language: z.enum(["Spanish", "English", "Portuguese"]).nullable(),
  language_inferred: z.boolean(),
  budget: z.number().nullable(),
  currency: z.enum(["USD", "COP", "EUR", "MXN"]).nullable(),
  exclude: z.string().nullable(),
  /** Fragmentos literales del texto que sustentan cada campo. */
  evidence: z.array(z.object({ field: z.string(), quote: z.string() })),
});

const SYSTEM = `Eres el asistente de una agencia de influencers. Conviertes la descripción libre de una campaña en campos estructurados.
Reglas:
- Solo rellenas lo que el texto dice. Lo que no está, va en null (o lista vacía). No inventes marca, presupuesto ni fechas.
- language: si el texto no lo dice, infiere por el idioma del texto y los países, y marca language_inferred=true.
- countries: códigos ISO alpha-2 derivados de location (Bogotá -> CO, Madrid -> ES, Mexico -> MX). "Latinoamérica"/"LatAm" se expande a MX, CO, AR, CL, PE; "España y Latinoamérica" incluye ES además de esos.
- followers: "20k" = 20000. age: "18 to 34" -> 18 y 34. budget: solo el número; currency aparte.
- name: un título corto y descriptivo para el scouting, tipo "Urban running — Bogotá & Medellín" (tema — lugar).
- evidence: por cada campo rellenado, el fragmento LITERAL del texto (copiado exacto) que lo sustenta.
Responde solo el JSON pedido.`;

export interface FieldsExtraction { name: string; fields: ScoutingFields; sources: Record<string, FieldSource>; spans: Span[]; costUsd: number }

export async function extractFields(description: string): Promise<FieldsExtraction> {
  const client = llm("reasoning");
  if (!client) return extractFieldsFallback(description);
  const res = await client.complete({ system: SYSTEM, user: description, schema: Extracted, schemaName: "brief_fields", maxTokens: 6000 });
  const e = res.data;
  const fields = ScoutingFieldsSchema.parse({
    brand: e.brand ?? "", product: e.product ?? "", goal: e.goal ?? "Brand awareness", launch_date: e.launch_date ?? "",
    creators_wanted: e.creators_wanted, platforms: e.platforms, followers_min: e.followers_min, followers_max: e.followers_max,
    min_engagement_pct: e.min_engagement_pct ?? 3, topics: e.topics, location: e.location ?? "", countries: e.countries.filter((c) => /^[A-Z]{2}$/.test(c)),
    age_min: e.age_min, age_max: e.age_max, language: e.language ?? "Spanish", budget: e.budget, currency: e.currency ?? "USD", exclude: e.exclude ?? "",
  });
  const sources = sourcesFor(fields, { languageInferred: e.language_inferred, minErSuggested: e.min_engagement_pct == null });
  return { name: e.name, fields, sources, spans: spansFrom(description, e.evidence), costUsd: res.costUsd };
}

function sourcesFor(f: ScoutingFields, o: { languageInferred: boolean; minErSuggested: boolean }): Record<string, FieldSource> {
  const s: Record<string, FieldSource> = {};
  const detected = (k: string, v: unknown) => { s[k] = v == null || v === "" || (Array.isArray(v) && !v.length) ? "missing" : "detected"; };
  detected("brand", f.brand); detected("product", f.product); detected("launch_date", f.launch_date); detected("creators_wanted", f.creators_wanted);
  detected("platforms", f.platforms); detected("followers", f.followers_min ?? f.followers_max); detected("topics", f.topics); detected("location", f.location);
  detected("age", f.age_min ?? f.age_max); detected("budget", f.budget); detected("goal", f.goal);
  s.language = o.languageInferred ? "inferred" : "detected";
  s.min_engagement_pct = o.minErSuggested ? "suggested" : "detected";
  s.name = "suggested";
  return s;
}

/** Localiza cada cita literal en el texto y numera los spans en orden de aparición. */
export function spansFrom(text: string, evidence: Array<{ field: string; quote: string }>): Span[] {
  const spans: Span[] = [];
  const lower = text.toLowerCase();
  for (const ev of evidence) {
    const q = ev.quote.trim().toLowerCase();
    if (q.length < 2) continue;
    const start = lower.indexOf(q);
    if (start < 0) continue;
    const end = start + q.length;
    if (spans.some((s) => start < s.end && end > s.start)) continue;
    spans.push({ field: ev.field, start, end, n: 0 });
  }
  spans.sort((a, b) => a.start - b.start);
  spans.forEach((s, i) => (s.n = i + 1));
  return spans;
}

/** Sin LLM: detección por regex, suficiente para desarrollo. */
export function extractFieldsFallback(text: string): FieldsExtraction {
  const t = text.toLowerCase();
  const platforms = (["tiktok", "instagram", "youtube"] as const).filter((p) => t.includes(p));
  const k = (m: RegExpMatchArray | null) => (m ? Math.round(parseFloat(m[1].replace(",", ".")) * (/k/i.test(m[2] ?? "") ? 1000 : 1)) : null);
  const range = text.match(/(\d+(?:[.,]\d+)?)\s*(k)?\s*(?:to|a|–|-)\s*(\d+(?:[.,]\d+)?)\s*(k)?\s*(?:followers|seguidores|subscribers)/i);
  const age = text.match(/(\d{2})\s*(?:to|a|–|-)\s*(\d{2})\s*(?:years|años)/i);
  const count = text.match(/(\d+)\s+(?:creators|creadoras|creadores|influencers)/i);
  const budget = text.match(/(?:budget|presupuesto)[^\d]{0,12}([\d.,]+)|[€$]\s?([\d.,]+)/i);
  const topics = DETECTORS[3][1].exec(text) ? [text.match(/(?:about|hablen de|de)\s+([a-záéíóúñ ]{3,40}?)(?:,|\.| with| con| in| en)/i)?.[1]?.trim() ?? "general"].filter(Boolean) : [];
  const fields = ScoutingFieldsSchema.parse({
    platforms, creators_wanted: count ? Number(count[1]) : null,
    followers_min: range ? k([range[0], range[1], range[2]] as unknown as RegExpMatchArray) : null,
    followers_max: range ? k([range[0], range[3], range[4]] as unknown as RegExpMatchArray) : null,
    age_min: age ? Number(age[1]) : null, age_max: age ? Number(age[2]) : null,
    budget: budget ? Number((budget[1] ?? budget[2]).replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")) : null,
    currency: /€|eur/i.test(text) ? "EUR" : /mxn/i.test(text) ? "MXN" : /cop/i.test(text) ? "COP" : "USD",
    topics, location: text.match(/\b(?:in|en)\s+([A-ZÁÉÍÓÚ][\wáéíóúñ]+(?:\s*(?:and|y|&|,)\s*[A-ZÁÉÍÓÚ][\wáéíóúñ]+)*)/)?.[1] ?? "",
    min_engagement_pct: 3,
  });
  const name = `${fields.topics[0] ?? "Scouting"}${fields.location ? " — " + fields.location : ""}`;
  return { name, fields, sources: sourcesFor(fields, { languageInferred: true, minErSuggested: true }), spans: [], costUsd: 0 };
}

/** Texto de brief que recibe el compilador del motor: descripción original más los campos confirmados. */
export function briefTextFrom(description: string, f: ScoutingFields): string {
  const lines = [description.trim(), "", "Campos confirmados por la agencia:"];
  if (f.brand) lines.push(`- Marca: ${f.brand}`);
  if (f.product) lines.push(`- Producto: ${f.product}`);
  lines.push(`- Objetivo: ${f.goal}`);
  if (f.launch_date) lines.push(`- Fecha de lanzamiento: ${f.launch_date}`);
  if (f.creators_wanted) lines.push(`- Creadoras buscadas: ${f.creators_wanted}`);
  if (f.platforms.length) lines.push(`- Plataformas: ${f.platforms.join(", ")}`);
  if (f.followers_min != null || f.followers_max != null) lines.push(`- Seguidores: ${f.followers_min ?? 0} a ${f.followers_max ?? "sin máximo"}`);
  if (f.min_engagement_pct != null) lines.push(`- Engagement mínimo: ${f.min_engagement_pct}%`);
  if (f.topics.length) lines.push(`- Temas: ${f.topics.join(", ")}`);
  if (f.location) lines.push(`- Ubicación de las creadoras: ${f.location}${f.countries.length ? ` (${f.countries.join(", ")})` : ""}`);
  if (f.age_min != null || f.age_max != null) lines.push(`- Edad de la audiencia: ${f.age_min ?? "?"} a ${f.age_max ?? "?"}`);
  lines.push(`- Idioma del contenido: ${f.language}`);
  if (f.budget != null) lines.push(`- Presupuesto total: ${f.budget} ${f.currency}`);
  if (f.exclude) lines.push(`- Excluir: ${f.exclude}`);
  return lines.join("\n");
}
