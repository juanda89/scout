import { z } from "zod";
import { PredicateSchema } from "./predicate.js";

export const RuleOpSchema = z.enum(["eq", "in", "any_of", "none_of", "between", "gte", "lte", "exists", "not_exists", "contains"]);

export const RuleSchema = z.object({
  op: RuleOpSchema,
  value: z.any().optional(),
  /** Si está, la regla se evalúa sobre el hecho derivado (ej. child.age_months), no sobre el valor crudo. */
  derived: z.string().optional(),
});
export type Rule = z.infer<typeof RuleSchema>;

export const RequirementSchema = z.object({
  id: z.string(),
  predicate: z.string(),
  rule: RuleSchema,
  hard: z.boolean().default(true),
  weight: z.number().min(0).max(1).optional(),
  min_evidence: z.number().int().min(1).default(1),
  max_evidence_age_days: z.number().int().positive().optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  /** Con cardinalidad many: basta un valor que cumpla (any) o deben cumplir todos (all). */
  match: z.enum(["any", "all"]).default("any"),
  rationale: z.string().optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

/** Filtro macro: se traduce a SQL sobre creator_facets. */
export const MacroFilterSchema = z.object({
  eq: z.any().optional(),
  any_of: z.array(z.any()).optional(),
  none_of: z.array(z.any()).optional(),
  between: z.tuple([z.number(), z.number()]).optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
});
export type MacroFilter = z.infer<typeof MacroFilterSchema>;

export const BriefSpecSchema = z.object({
  title: z.string(),
  summary: z.string().optional(),
  macro_filters: z.record(MacroFilterSchema).default({}),
  requirements: z.array(RequirementSchema).default([]),
  /** Predicados que no existían y el compilador propone registrar. */
  new_predicates: z.array(PredicateSchema).default([]),
  budget: z.object({
    max_candidates_deep: z.number().int().positive().default(300),
    max_usd: z.number().positive().default(100),
  }).default({}),
  open_questions: z.array(z.string()).default([]),
});
export type BriefSpec = z.infer<typeof BriefSpecSchema>;
export type BriefSpecInput = z.input<typeof BriefSpecSchema>;
