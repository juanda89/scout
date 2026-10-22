import { describe, expect, it } from "vitest";
import { mockJevAnswer } from "../src/extract/jev.js";
import { extractor } from "../src/extract/extractor.js";
import { PredicateSchema } from "../src/schema/predicate.js";
import { normalizeApifyItems } from "../src/ingest/apify.js";


describe("mock Jev", () => {
  const spec = { type: "choice" as const, instructions: "", criteria: {}, none_labels: [] };
  it("detecta etapa de vida y país por palabras clave", () => {
    expect(mockJevAnswer("life_stage", spec, "Hoy mi bebé cumple 6 meses").choice).toBe("parent");
    expect(mockJevAnswer("life_stage", spec, "Semana 30 de embarazo").choice).toBe("pregnant");
    expect(mockJevAnswer("life_stage", spec, "No tengo hijos y no quiero").choice).toBe("unknown");
    expect(mockJevAnswer("location.country", spec, "Mamá de Martina | Madrid").choice).toBe("ES");
    expect(mockJevAnswer("gender", spec, "Papá primerizo de Valentina").choice).toBe("male");
    expect(mockJevAnswer("age_bracket", spec, "Tengo 23 años y un objetivo").choice).toBe("18-24");
  });
  it("patrocinio como noul", () => {
    expect(mockJevAnswer("sponsorship.has_history", { ...spec, type: "noul" }, "#ad en colaboración con @marca").noul).toBeGreaterThan(0.9);
  });
});

describe("mock Claude", () => {
  const ageMention = PredicateSchema.parse({ key: "child.age_mention", label: "", tier: "micro", value_type: "object", value_schema: { required: ["amount", "unit"] }, temporal_kind: "point_in_time", cardinality: "many", extraction_spec: { provider: "claude", modalities: ["caption"] } });
  const item = (id: string, caption: string) => ({ id, creator_id: "c", kind: "post", posted_at: new Date("2026-05-20T00:00:00Z"), caption, transcript: null, vision_description: null });
  it("extrae menciones de edad con unidad", async () => {
    const r = await extractor().extract("x", [item("1", "Entrenar con mi hijo de 1 año y medio encima"), item("2", "Leo cumple 15 meses"), item("3", "los peques de 7 y 9 años")], [ageMention]);
    const values = r.claims.map((c) => c.value);
    expect(values).toContainEqual({ amount: 18, unit: "months" });
    expect(values).toContainEqual({ amount: 15, unit: "months" });
    expect(values).toContainEqual({ amount: 7, unit: "years" });
    expect(values).toContainEqual({ amount: 9, unit: "years" });
    expect(r.claims.every((c) => c.evidence_span.length > 0)).toBe(true);
  });
});

describe("normalizeApifyItems", () => {
  it("agrupa posts por autor y normaliza campos", () => {
    const items = [
      { id: "a1", ownerUsername: "Laura", ownerFullName: "Laura", caption: "hola", timestamp: "2026-01-01T00:00:00Z", likesCount: 10, commentsCount: 2, type: "Video" },
      { id: "a2", ownerUsername: "laura", caption: { text: "otro" }, taken_at: 1767225600, like_count: 5 },
    ];
    const out = normalizeApifyItems(items, "apify:test", 50);
    expect(out).toHaveLength(1);
    expect(out[0].handle).toBe("laura");
    expect(out[0].posts.map((p) => p.kind)).toEqual(["reel", "post"]);
    expect(out[0].posts[1].caption).toBe("otro");
    expect(out[0].posts[1].posted_at).toBe("2026-01-01T00:00:00.000Z");
  });
});
