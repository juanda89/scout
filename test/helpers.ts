import type { Claim } from "../src/schema/claim.js";
import { PredicateSchema, type Predicate } from "../src/schema/predicate.js";

let seq = 0;
export function claim(partial: Partial<Claim> & { predicate_key: string; value: unknown }): Claim {
  seq++;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    creator_id: "11111111-1111-1111-1111-111111111111",
    predicate_version: 1,
    polarity: "affirms",
    observed_at: new Date("2026-01-01T00:00:00Z"),
    evidence_content_id: `22222222-2222-2222-2222-${String(seq).padStart(12, "0")}`,
    evidence_span: "...",
    evidence_modality: "caption",
    confidence: 0.95,
    extractor: {},
    status: "auto",
    ...partial,
  };
}

export const NOW = new Date("2026-10-21T00:00:00Z");

export function predicates(): Map<string, Predicate> {
  const list = [
    { key: "child.age_mention", label: "", tier: "micro", value_type: "object", temporal_kind: "point_in_time", cardinality: "many",
      derivations: [{ name: "child.age_months", fn: "months_since_observed_plus_age" }] },
    { key: "child.birth_event", label: "", tier: "micro", value_type: "object", temporal_kind: "event", cardinality: "many",
      derivations: [{ name: "child.age_months", fn: "months_since_observed" }] },
    { key: "wearable.brand", label: "", tier: "micro", value_type: "enum", value_schema: { values: ["garmin", "apple"] }, temporal_kind: "slow", cardinality: "one" },
    { key: "content.category", label: "", tier: "macro", value_type: "enum", value_schema: { values: ["maternidad", "running"] }, temporal_kind: "slow", cardinality: "many" },
    { key: "audience.gender_female_pct", label: "", tier: "micro", value_type: "number", temporal_kind: "slow", cardinality: "one", extraction_spec: { provider: "external_api", modalities: [] } },
  ];
  return new Map(list.map((p) => [p.key, PredicateSchema.parse(p)]));
}
