import { describe, expect, it } from "vitest";
import { buildMacroWhere } from "../src/funnel/macro-query.js";

describe("buildMacroWhere", () => {
  it("traduce filtros a SQL parametrizado", () => {
    const { sql, params } = buildMacroWhere({
      life_stage: { any_of: ["parent"] },
      gender: { eq: "female" },
      followers: { between: [5000, 500000] },
      "brand_safety.flags": { none_of: ["adult"] },
    });
    expect(sql).toContain(`f.facets -> $1 @> $2::jsonb`);
    expect(sql).toContain(`f.followers BETWEEN $5 AND $6`);
    expect(sql).toContain(`NOT (COALESCE(f.facets -> $7 @> $8::jsonb, false))`);
    expect(params).toEqual(["life_stage", '["parent"]', "gender", '["female"]', 5000, 500000, "brand_safety.flags", '["adult"]']);
  });
  it("sin filtros devuelve true", () => {
    expect(buildMacroWhere({}).sql).toBe("true");
  });
});
