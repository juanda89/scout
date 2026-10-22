import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateSpec } from "../src/brief/validate.js";
import { BriefSpecSchema } from "../src/schema/brief.js";
import { PredicateSchema } from "../src/schema/predicate.js";
import { SEED_PREDICATES } from "../src/registry/seed.js";

const registry = new Map(SEED_PREDICATES.map((p) => { const x = PredicateSchema.parse(p); return [x.key, x]; }));

describe("validateSpec", () => {
  it("las specs de fixtures son válidas contra el seed", () => {
    for (const f of ["mamas-1-3", "runners-madrid"]) {
      const spec = BriefSpecSchema.parse(JSON.parse(readFileSync(`fixtures/briefspecs/${f}.json`, "utf8")));
      expect(validateSpec(spec, registry)).toEqual([]);
    }
  });
  it("detecta predicados desconocidos, filtros macro sobre micro y pesos mal sumados", () => {
    const spec = BriefSpecSchema.parse({
      title: "x",
      macro_filters: { "audience.gender_female_pct": { eq: 1 }, nope: { eq: "a" }, gender: { eq: "robot" } },
      requirements: [
        { id: "a", predicate: "zzz", rule: { op: "exists" }, hard: true },
        { id: "b", predicate: "content.category", rule: { op: "eq", value: "x" }, hard: false, weight: 0.5 },
        { id: "c", predicate: "child.age_mention", rule: { op: "between", value: [1, 2], derived: "nada" }, hard: true },
      ],
      new_predicates: [{ key: "child.age_mention", label: "", tier: "micro", value_type: "object", temporal_kind: "point_in_time" }],
    });
    const errors = validateSpec(spec, registry);
    expect(errors.some((e) => e.includes("predicado micro: audience.gender_female_pct"))).toBe(true);
    expect(errors.some((e) => e.includes("desconocido: nope"))).toBe(true);
    expect(errors.some((e) => e.includes("'robot' no está en el enum"))).toBe(true);
    expect(errors.some((e) => e.includes("predicado desconocido zzz"))).toBe(true);
    expect(errors.some((e) => e.includes("ningún predicado deriva nada"))).toBe(true);
    expect(errors.some((e) => e.includes("deberían sumar 1"))).toBe(true);
  });
});
