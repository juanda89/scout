import { describe, expect, it } from "vitest";
import { applyFieldsToSpec } from "../src/scouting/pipeline.js";
import { BriefSpecSchema } from "../src/schema/brief.js";

describe("applyFieldsToSpec", () => {
  it("convierte filtros macro no esenciales en requisitos duros con la forma {op, value}", () => {
    const spec = BriefSpecSchema.parse({ title: "t", macro_filters: { gender: { eq: "female" }, life_stage: { any_of: ["parent"] }, "content.category": { any_of: ["maternidad"] } }, requirements: [], budget: { max_candidates_deep: 40, max_usd: 10 } });
    const s = { fields: { followers_min: 50000, followers_max: 300000, language: "Spanish", countries: ["CO"], creators_wanted: 5 } } as never;
    const out = applyFieldsToSpec(spec, s);
    expect(out.macro_filters.gender).toBeUndefined();
    expect(out.macro_filters.life_stage).toBeUndefined();
    expect(out.macro_filters["content.category"]).toEqual({ any_of: ["maternidad"] });
    expect(out.requirements.map((r) => [r.predicate, r.rule.op, r.hard])).toEqual([["gender", "eq", true], ["life_stage", "any_of", true]]);
    expect(out.macro_filters.followers).toEqual({ between: [45000, 330000] });
  });
});
