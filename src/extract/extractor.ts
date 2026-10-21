import { z } from "zod/v4";
import { PRICES } from "../config.js";
import { llm, type LlmClient } from "../llm/client.js";
import type { Predicate } from "../schema/predicate.js";
import type { ContentItem } from "./content.js";
import { textOf } from "./content.js";

export interface ExtractedClaim {
  predicate_key: string;
  value: unknown;
  polarity: "affirms" | "denies";
  evidence_content_id: string;
  evidence_span: string;
  evidence_modality: "bio" | "caption" | "transcript" | "vision";
  confidence: number;
}

export interface ExtractionResult { claims: ExtractedClaim[]; inputTokens: number; outputTokens: number; costUsd: number }

export interface Extractor {
  readonly mode: "live" | "mock";
  readonly label: string;
  extract(handle: string, items: ContentItem[], predicates: Predicate[]): Promise<ExtractionResult>;
}

/** Salida estructurada. El valor viaja como JSON en string para mantener el esquema estricto. */
const OutputSchema = z.object({
  claims: z.array(z.object({
    predicate_key: z.string(),
    value_json: z.string(),
    polarity: z.enum(["affirms", "denies"]),
    evidence_content_id: z.string(),
    evidence_span: z.string(),
    evidence_modality: z.enum(["bio", "caption", "transcript", "vision"]),
    confidence: z.number(),
  })),
});

const SYSTEM = `Eres un extractor de hechos sobre creadoras de contenido para una agencia de influencers.
Reglas estrictas:
1. Solo afirmas lo que el contenido dice de forma literal o inequívoca. Nada de suposiciones.
2. Cada claim cita el fragmento exacto (evidence_span) y el id del contenido de donde sale.
3. value_json debe cumplir el value_schema del predicado. Para menciones de edad usa {"amount": N, "unit": "months"|"years"|"weeks"}.
4. polarity "denies" solo cuando el texto niega explícitamente el hecho.
5. confidence calibrada: 0.95+ si es literal, 0.7-0.9 si es inequívoco pero indirecto. Si dudas, no emitas el claim.
6. Sobre menores: solo edad en rango y eventos con fecha. Nunca nombres, descripciones físicas ni ubicación de niños.
7. Un claim por evidencia. Si varios posts prueban lo mismo, emite un claim por post.
Si no hay evidencia para un predicado, simplemente no lo incluyas.`;

class LlmExtractor implements Extractor {
  readonly mode = "live" as const;
  readonly label: string;
  constructor(private client: LlmClient) { this.label = `${client.provider}/${client.model}`; }
  async extract(handle: string, items: ContentItem[], predicates: Predicate[]): Promise<ExtractionResult> {
    const content = items.flatMap((it) => textOf(it).map((t) => ({ id: it.id, kind: it.kind, posted_at: it.posted_at?.toISOString().slice(0, 10) ?? null, modality: t.modality, text: t.text })));
    const preds = predicates.map((p) => ({ key: p.key, label: p.label, value_type: p.value_type, value_schema: p.value_schema, cardinality: p.cardinality, temporal_kind: p.temporal_kind, instructions: p.extraction_spec.claude?.instructions ?? "" }));
    const res = await this.client.complete({
      system: SYSTEM,
      user: `Creadora: @${handle}\n\nPREDICADOS A EXTRAER:\n${JSON.stringify(preds, null, 1)}\n\nCONTENIDO (id, tipo, fecha, modalidad, texto):\n${JSON.stringify(content, null, 1)}`,
      schema: OutputSchema, schemaName: "claims", maxTokens: 16000,
    });
    const claims: ExtractedClaim[] = [];
    for (const c of res.data.claims) {
      let value: unknown;
      try { value = JSON.parse(c.value_json); } catch { continue; }
      claims.push({ ...c, value, confidence: Math.max(0, Math.min(1, c.confidence)) });
    }
    return { claims, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd };
  }
}

/* ---------- Mock determinista basado en expresiones regulares (solo para correr sin claves) ---------- */

const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, primer: 1 };
function n(s: string): number { return NUM[s.toLowerCase()] ?? Number(s); }
function unitOf(u: string): "months" | "years" | "weeks" { return /^sem/i.test(u) ? "weeks" : /^mes/i.test(u) ? "months" : "years"; }

type Handler = (text: string, modality: ExtractedClaim["evidence_modality"]) => Array<Omit<ExtractedClaim, "predicate_key" | "evidence_content_id" | "evidence_modality">>;

const HANDLERS: Record<string, Handler> = {
  "child.age_mention": (text) => {
    const out: Array<{ value: unknown; polarity: "affirms"; evidence_span: string; confidence: number }> = [];
    const push = (span: string, amount: number, unit: "months" | "years" | "weeks") => out.push({ value: { amount, unit }, polarity: "affirms", evidence_span: span, confidence: 0.92 });
    const patterns: Array<[RegExp, (m: RegExpMatchArray) => void]> = [
      [/(?:beb[eé]|hij[oa]|peque|ni[ñn][oa]|toddler)[^.\n]{0,25}?\b(\d{1,2}|un|una|dos|tres)\s+(meses|mes|a[ñn]os?|a[ñn]ito|semanas)(\s+y\s+medio)?/gi, (m) => push(m[0], n(m[1]) * (m[3] && unitOf(m[2]) === "years" ? 12 : 1) + (m[3] ? (unitOf(m[2]) === "years" ? 6 : 0) : 0), m[3] && unitOf(m[2]) === "years" ? "months" : unitOf(m[2]))],
      [/cumple\s+(\d{1,2}|un)\s+(meses|a[ñn]os?|a[ñn]ito)/gi, (m) => push(m[0], n(m[1]), unitOf(m[2]))],
      [/cumpli[oó]\s+(\d{1,2}|un)\s+(a[ñn]ito|a[ñn]os?|meses)/gi, (m) => push(m[0], n(m[1]), unitOf(m[2]))],
      [/primer\s+a[ñn]ito\s+de\s+\w+/gi, (m) => push(m[0], 12, "months")],
      [/con\s+(\d{1,2})\s+meses\s+ya/gi, (m) => push(m[0], Number(m[1]), "months")],
      [/(\d{1,2})\s+meses\s+despu[eé]s\s+del\s+nacimiento/gi, (m) => push(m[0], Number(m[1]), "months")],
      [/ya\s+tiene\s+(\d{1,2})\s+a[ñn]os(\s+y\s+medio)?/gi, (m) => push(m[0], Number(m[1]) * 12 + (m[2] ? 6 : 0), "months")],
      [/peques\s+de\s+(\d{1,2})\s+y\s+(\d{1,2})\s+a[ñn]os/gi, (m) => { push(m[0], Number(m[1]), "years"); push(m[0], Number(m[2]), "years"); }],
    ];
    for (const [re, fn] of patterns) for (const m of text.matchAll(re)) fn(m);
    // dedupe por span
    const seen = new Set<string>();
    return out.filter((o) => { const k = o.evidence_span + JSON.stringify(o.value); if (seen.has(k)) return false; seen.add(k); return true; });
  },
  "child.birth_event": (text) => {
    const m = text.match(/\bnaci[oó]\s+[A-ZÁÉÍÓÚ]\w+|\bbienvenid[oa],?\s+hij[oa]|ya\s+est[aá]\s+aqu[ií]/i);
    return m ? [{ value: { kind: "birth" }, polarity: "affirms", evidence_span: m[0], confidence: 0.95 }] : [];
  },
  "wearable.brand": (text) => {
    const m = text.match(/\b(garmin|apple watch|coros|polar|suunto)\b/i);
    if (!m) return [];
    const brand = m[1].toLowerCase().replace(" ", "_");
    return [{ value: brand === "apple_watch" ? "apple" : brand, polarity: "affirms", evidence_span: m[0], confidence: 0.95 }];
  },
  "sport.event_participation": (text) => {
    const out: Array<{ value: unknown; polarity: "affirms"; evidence_span: string; confidence: number }> = [];
    if (/media\s+marat[oó]n/i.test(text)) out.push({ value: "half_marathon", polarity: "affirms", evidence_span: text.match(/media\s+marat[oó]n[^.]{0,30}/i)![0], confidence: 0.9 });
    else if (/marat[oó]n/i.test(text)) out.push({ value: "marathon", polarity: "affirms", evidence_span: text.match(/marat[oó]n[^.]{0,30}/i)![0], confidence: 0.9 });
    if (/\b10k\b/i.test(text)) out.push({ value: "10k", polarity: "affirms", evidence_span: "10k", confidence: 0.9 });
    return out;
  },
  "location.city": (text, modality) => {
    if (modality !== "bio") return [];
    const m = text.match(/\b(Madrid|Valencia|Sevilla|Barcelona|Bilbao|Zaragoza|M[aá]laga|CDMX|Monterrey|Bogot[aá])\b/i);
    return m ? [{ value: m[1].replace(/^cdmx$/i, "Ciudad de México"), polarity: "affirms", evidence_span: m[0], confidence: 0.9 }] : [];
  },
};

class MockExtractor implements Extractor {
  readonly mode = "mock" as const;
  readonly label = "mock";
  async extract(_handle: string, items: ContentItem[], predicates: Predicate[]): Promise<ExtractionResult> {
    const claims: ExtractedClaim[] = [];
    let chars = 0;
    for (const p of predicates) {
      const h = HANDLERS[p.key];
      if (!h) { console.warn(`[extractor:mock] sin handler para ${p.key}; en vivo el LLM lo extraería`); continue; }
      for (const it of items) for (const t of textOf(it)) {
        if (!p.extraction_spec.modalities.includes(t.modality)) continue;
        chars += t.text.length;
        for (const c of h(t.text, t.modality)) claims.push({ ...c, predicate_key: p.key, evidence_content_id: it.id, evidence_modality: t.modality });
      }
    }
    const inputTokens = Math.ceil(chars / 4) + 800;
    const outputTokens = claims.length * 60;
    return { claims, inputTokens, outputTokens, costUsd: (inputTokens / 1e6) * PRICES.claudeInPerMTok + (outputTokens / 1e6) * PRICES.claudeOutPerMTok };
  }
}

let instance: Extractor | null = null;
export function extractor(): Extractor {
  if (!instance) { const c = llm("reasoning"); instance = c ? new LlmExtractor(c) : new MockExtractor(); }
  return instance;
}
