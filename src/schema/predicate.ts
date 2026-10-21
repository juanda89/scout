import { z } from "zod";

export const PREDICATE_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** Pregunta Jev declarada en el predicado. value_map traduce la etiqueta elegida al valor del claim. */
export const JevSpecSchema = z.object({
  type: z.enum(["noul", "choice", "score"]),
  instructions: z.string(),
  criteria: z.union([z.record(z.string().nullable()), z.array(z.string())]).optional(),
  /** Etiquetas de choice que significan "no aplica": no generan claim. */
  none_labels: z.array(z.string()).default([]),
  value_map: z.record(z.any()).optional(),
});

export const ExtractionSpecSchema = z.object({
  provider: z.enum(["jev", "claude", "metrics", "external_api", "none"]).default("jev"),
  modalities: z.array(z.enum(["caption", "bio", "transcript", "vision"])).default(["caption", "bio"]),
  jev: JevSpecSchema.optional(),
  /** Instrucción en lenguaje natural para extracción profunda con Claude. */
  claude: z.object({ instructions: z.string() }).optional(),
  /** Alcance de contenido a mirar. */
  scope: z.object({ max_items: z.number().int().positive().default(30) }).default({}),
});

export const DerivationSchema = z.object({
  /** Nombre del hecho virtual que produce, ej. "child.age_months". */
  name: z.string(),
  /** Función determinista implementada en src/rules/derivations.ts */
  fn: z.enum(["months_since_observed", "months_since_observed_plus_age", "years_since_observed_plus_age", "value_field"]),
  params: z.record(z.any()).default({}),
});

export const PredicateSchema = z.object({
  key: z.string().regex(PREDICATE_KEY_RE, "clave de predicado inválida"),
  label: z.string(),
  tier: z.enum(["macro", "micro"]),
  value_type: z.enum(["enum", "number", "date", "text", "object", "boolean"]),
  value_schema: z.record(z.any()).default({}),
  temporal_kind: z.enum(["static", "slow", "event", "point_in_time"]),
  cardinality: z.enum(["one", "many"]).default("one"),
  extraction_spec: ExtractionSpecSchema.default({}),
  derivations: z.array(DerivationSchema).default([]),
  created_from_brief: z.string().uuid().nullable().optional(),
  version: z.number().int().positive().default(1),
});

export type Predicate = z.infer<typeof PredicateSchema>;
export type PredicateInput = z.input<typeof PredicateSchema>;
export type Derivation = z.infer<typeof DerivationSchema>;
export type JevSpec = z.infer<typeof JevSpecSchema>;

/** Valida un valor contra el value_schema del predicado. Devuelve el error o null. */
export function validateValue(p: Predicate, value: unknown): string | null {
  switch (p.value_type) {
    case "enum": {
      const values: unknown[] = Array.isArray(p.value_schema.values) ? p.value_schema.values : [];
      if (values.length && !values.includes(value)) return `valor '${String(value)}' no está en enum de ${p.key}`;
      return typeof value === "string" ? null : `enum ${p.key} espera string`;
    }
    case "boolean":
      return typeof value === "boolean" ? null : `${p.key} espera boolean`;
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) return `${p.key} espera number`;
      const { min, max } = p.value_schema as { min?: number; max?: number };
      if (min !== undefined && value < min) return `${p.key} < min ${min}`;
      if (max !== undefined && value > max) return `${p.key} > max ${max}`;
      return null;
    }
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? null : `${p.key} espera fecha ISO`;
    case "text":
      return typeof value === "string" ? null : `${p.key} espera string`;
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return `${p.key} espera objeto`;
      const required: string[] = Array.isArray(p.value_schema.required) ? p.value_schema.required : [];
      for (const r of required) if (!(r in (value as Record<string, unknown>))) return `${p.key} requiere campo ${r}`;
      return null;
    }
  }
}
