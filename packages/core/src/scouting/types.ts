import { z } from "zod";

export const PlatformSchema = z.enum(["instagram", "tiktok", "youtube"]);
export type Platform = z.infer<typeof PlatformSchema>;

/** Campos de negocio del brief, tal como los confirma el usuario en la pantalla "Confirm the brief". */
export const ScoutingFieldsSchema = z.object({
  brand: z.string().default(""),
  product: z.string().default(""),
  goal: z.enum(["Product launch", "Brand awareness", "Sales and conversions", "UGC content"]).default("Brand awareness"),
  launch_date: z.string().default(""),
  creators_wanted: z.number().int().positive().nullable().default(null),
  platforms: z.array(PlatformSchema).default([]),
  followers_min: z.number().int().nonnegative().nullable().default(null),
  followers_max: z.number().int().positive().nullable().default(null),
  min_engagement_pct: z.number().nonnegative().nullable().default(null),
  topics: z.array(z.string()).default([]),
  location: z.string().default(""),
  countries: z.array(z.string().length(2)).default([]),   // ISO alpha-2 derivados de location
  age_min: z.number().int().nullable().default(null),
  age_max: z.number().int().nullable().default(null),
  language: z.enum(["Spanish", "English", "Portuguese"]).default("Spanish"),
  budget: z.number().nonnegative().nullable().default(null),
  currency: z.enum(["USD", "COP", "EUR", "MXN"]).default("USD"),
  exclude: z.string().default(""),
});
export type ScoutingFields = z.infer<typeof ScoutingFieldsSchema>;

export const FieldSourceSchema = z.enum(["detected", "suggested", "inferred", "user", "missing"]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

export const SpanSchema = z.object({ field: z.string(), start: z.number().int(), end: z.number().int(), n: z.number().int() });
export type Span = z.infer<typeof SpanSchema>;

export const ScoutingStatusSchema = z.enum(["draft", "queued", "running", "done", "failed", "cancelled"]);
export type ScoutingStatus = z.infer<typeof ScoutingStatusSchema>;

export interface Scouting {
  id: string;
  owner_id: number | null;
  name: string;
  status: ScoutingStatus;
  description: string;
  fields: ScoutingFields;
  field_sources: Record<string, FieldSource>;
  spans: Span[];
  brief_id: string | null;
  spec_id: string | null;
  run_id: string | null;
  stage: number;
  stage_progress: number;
  metrics: ScoutingMetrics;
  notify_email: boolean;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  updated_at: Date;
}

export interface ScoutingMetrics {
  criteria?: number;
  found?: number;
  passed?: number;
  analyzed?: number;
  strong?: number;
  cost_usd?: number;
  profiles_analyzed?: number;
}

/** Las cinco etapas del diseño. `mode` es el estado del Orb. */
export const STAGES = [
  { n: 1, key: "interpret", title: "Interpreting the brief", description: "Turning your description into search criteria and filters.", mode: "listening" },
  { n: 2, key: "find", title: "Finding candidates", description: "Searching the selected platforms for profiles that match the topics and location.", mode: "searching" },
  { n: 3, key: "analyze", title: "Analyzing content", description: "Reviewing posts, topics and posting frequency for every profile that passed the filters.", mode: "working" },
  { n: 4, key: "audience", title: "Evaluating audiences", description: "Cross-checking each candidate’s audience location, age and authenticity.", mode: "connecting" },
  { n: 5, key: "score", title: "Scoring fit", description: "Scoring every creator against your brief and ranking the results.", mode: "solving" },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];

export interface FitParts { topic: number; audience: number; engagement: number; brand_safety: number }
/** El presupuesto no puntúa: es contexto para la negociación, no un criterio de encaje. */
export const FIT_WEIGHTS: FitParts = { topic: 0.4, audience: 0.3, engagement: 0.2, brand_safety: 0.1 };
export const FIT_LABELS: Record<keyof FitParts, string> = { topic: "Topic", audience: "Audience (location and age)", engagement: "Engagement", brand_safety: "Brand safety" };

export type Tier = "excellent" | "very_good" | "good";
export function tierOf(fit: number): Tier { return fit >= 90 ? "excellent" : fit >= 80 ? "very_good" : "good"; }

export interface ScoutingResult {
  scouting_id: string;
  creator_id: string;
  rank: number;
  fit: number;
  fit_parts: FitParts;
  tier: Tier;
  verdict: "PASS" | "UNKNOWN";
  summary: string | null;
  pros: string[];
  cons: string[];
  /** Columna histórica; ya no se estima tarifa (siempre null en resultados nuevos). */
  estimated_rate_usd: number | null;
  followers: number | null;
  er: number | null;
  target_audience_pct: number | null;
  platform: string | null;
  city: string | null;
  preliminary: boolean;
  evidence_claim_ids: string[];
  // joined
  handle?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  on_shortlist?: boolean;
}

export interface ScoutingEvent { id: number; scouting_id: string; stage: number | null; at: Date; kind: string; text: string; data: unknown }
