import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { llm } from "../llm/client.js";
import { BriefSpecSchema, type BriefSpec, type BriefSpecInput } from "../schema/brief.js";
import type { Predicate } from "../schema/predicate.js";

/** Esquema de salida estricto para Claude: valores como JSON en string, opcionales como nullable. */
const CompileOutput = z.object({
  title: z.string(),
  summary: z.string(),
  macro_filters: z.array(z.object({
    predicate: z.string(),
    op: z.enum(["eq", "any_of", "none_of", "between", "gte", "lte"]),
    value_json: z.string(),
  })),
  requirements: z.array(z.object({
    id: z.string(),
    predicate: z.string(),
    op: z.enum(["eq", "in", "any_of", "none_of", "between", "gte", "lte", "exists", "not_exists", "contains"]),
    value_json: z.string().nullable(),
    derived: z.string().nullable(),
    hard: z.boolean(),
    weight: z.number().nullable(),
    min_evidence: z.number(),
    max_evidence_age_days: z.number().nullable(),
    rationale: z.string(),
  })),
  new_predicates: z.array(z.object({
    key: z.string(),
    label: z.string(),
    value_type: z.enum(["enum", "number", "date", "text", "object", "boolean"]),
    value_schema_json: z.string(),
    temporal_kind: z.enum(["static", "slow", "event", "point_in_time"]),
    cardinality: z.enum(["one", "many"]),
    provider: z.enum(["jev", "claude"]),
    modalities: z.array(z.enum(["caption", "bio", "transcript", "vision"])),
    jev_question_json: z.string().nullable(),
    claude_instructions: z.string().nullable(),
    /** Hechos virtuales que este predicado produce. Vacío si no aplica. */
    derivations: z.array(z.object({
      name: z.string(),
      fn: z.enum(["months_since_observed", "months_since_observed_plus_age", "years_since_observed_plus_age", "value_field"]),
      field: z.string().nullable(),
    })),
  })),
  open_questions: z.array(z.string()),
});

const SYSTEM = `Eres el compilador de briefs de una herramienta de scouting de creadoras. Conviertes un brief de marca en una
especificación determinista. Reglas:
1. MACRO primero: todo lo que se pueda expresar con los predicados macro existentes va en macro_filters (son filtros SQL baratos).
   Claves especiales: "followers" y "er_estimate" son numéricas (between/gte/lte).
2. Lo específico va en requirements. Reutiliza predicados existentes siempre que cubran el pedido; solo propone new_predicates si ninguno sirve.
3. Para atributos que envejecen (edad de hijos, tiempo desde un evento) usa predicados con derivación y evalúa la regla con "derived" (el nombre del hecho virtual, ej. "child.age_months") y un operador numérico.
   Derivaciones (fn): months_since_observed = meses desde la fecha del post (eventos: nacimiento, boda, mudanza);
   months_since_observed_plus_age = la mención de edad {"amount": N, "unit": "months"|"years"|"weeks"} más los meses transcurridos desde el post;
   years_since_observed_plus_age = lo mismo en años; value_field = toma el campo "field" del valor.
   Ejemplo: predicado child.age_mention (value_type object, value_schema {"required":["amount","unit"]}, cardinality many, temporal point_in_time,
   derivations [{"name":"child.age_months","fn":"months_since_observed_plus_age","field":null}]) y requisito {predicate:"child.age_mention", op:"between", value_json:"[12,36]", derived:"child.age_months"}.
   Dos predicados distintos pueden derivar el mismo nombre (una mención de edad y un anuncio de nacimiento); la regla los suma como evidencia.
4. Requisitos duros: min_evidence 2 por defecto si el error es costoso; blandos con weight que sume 1.
5. Predicados nuevos: key en snake.case con punto, enum cerrado cuando sea posible, provider "jev" si es clasificable con una pregunta cerrada (elige type noul/choice/score y escribe criteria), "claude" si requiere extraer un valor libre o estructurado.
6. Lo que no esté claro en el brief va en open_questions, no se inventa.
Devuelve solo el objeto pedido.`;

function toSpec(o: z.infer<typeof CompileOutput>): BriefSpecInput {
  const macro: Record<string, Record<string, unknown>> = {};
  for (const f of o.macro_filters) macro[f.predicate] = { ...(macro[f.predicate] ?? {}), [f.op]: JSON.parse(f.value_json) };
  return {
    title: o.title,
    summary: o.summary,
    macro_filters: macro as BriefSpecInput["macro_filters"],
    requirements: o.requirements.map((r) => ({
      id: r.id, predicate: r.predicate,
      rule: { op: r.op, ...(r.value_json ? { value: JSON.parse(r.value_json) } : {}), ...(r.derived ? { derived: r.derived } : {}) },
      hard: r.hard, ...(r.weight != null ? { weight: r.weight } : {}), min_evidence: r.min_evidence,
      ...(r.max_evidence_age_days != null ? { max_evidence_age_days: r.max_evidence_age_days } : {}), rationale: r.rationale,
    })),
    new_predicates: o.new_predicates.map((p) => ({
      key: p.key, label: p.label, tier: "micro" as const, value_type: p.value_type, value_schema: JSON.parse(p.value_schema_json),
      temporal_kind: p.temporal_kind, cardinality: p.cardinality,
      extraction_spec: {
        provider: p.provider, modalities: p.modalities,
        ...(p.jev_question_json ? { jev: JSON.parse(p.jev_question_json) } : {}),
        ...(p.claude_instructions ? { claude: { instructions: p.claude_instructions } } : {}),
      },
      derivations: p.derivations.map((d) => ({ name: d.name, fn: d.fn, params: d.field ? { field: d.field } : {} })),
    })),
    open_questions: o.open_questions,
  };
}

export interface CompileResult { spec: BriefSpec; compiledBy: Record<string, unknown> }

export async function compileBrief(text: string, existing: Predicate[], title?: string): Promise<CompileResult> {
  const client = llm("reasoning");
  if (!client) return compileMock(text, title);
  const registry = existing.map((p) => ({ key: p.key, tier: p.tier, label: p.label, value_type: p.value_type, values: p.value_schema.values ?? null, cardinality: p.cardinality, derivations: p.derivations.map((d) => d.name) }));
  const res = await client.complete({
    system: SYSTEM,
    user: `REGISTRO DE PREDICADOS EXISTENTES:\n${JSON.stringify(registry, null, 1)}\n\nBRIEF:\n${text}${title ? `\n\nTítulo sugerido: ${title}` : ""}`,
    schema: CompileOutput, schemaName: "brief_spec", maxTokens: 16000,
  });
  const spec = BriefSpecSchema.parse(toSpec(res.data));
  return { spec, compiledBy: { provider: client.provider, model: client.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd } };
}

/** Sin clave: busca una spec precompilada en fixtures/briefspecs por título o por coincidencia de palabras. */
function compileMock(text: string, title?: string): CompileResult {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, "..", "..", "fixtures", "briefspecs");
  const candidates: Array<[string, RegExp]> = [
    ["mamas-1-3.json", /mam[aá]s|hijos|beb[eé]/i],
    ["runners-madrid.json", /marat|garmin|runner|corr/i],
  ];
  for (const [file, re] of candidates) {
    const full = path.join(dir, file);
    if (existsSync(full) && (re.test(text) || (title && re.test(title)))) {
      const spec = BriefSpecSchema.parse(JSON.parse(readFileSync(full, "utf8")));
      if (title) spec.title = title;
      return { spec, compiledBy: { provider: "mock", fixture: file } };
    }
  }
  throw new Error("Modo mock: no hay spec precompilada para este brief. Configura OPENROUTER_API_KEY o ANTHROPIC_API_KEY para compilar briefs nuevos.");
}
