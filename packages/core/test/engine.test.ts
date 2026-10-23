import { describe, expect, it } from "vitest";
import { evaluateCreator, evaluateRequirement, testRule } from "../src/rules/engine.js";
import type { Requirement } from "../src/schema/brief.js";
import { RequirementSchema, BriefSpecSchema } from "../src/schema/brief.js";
import { PredicateSchema } from "../src/schema/predicate.js";
import { claim, NOW, predicates } from "./helpers.js";

const ctx = { now: NOW, predicates: predicates(), defaultMinConfidence: 0.85 };
const req = (r: Partial<Requirement> & { predicate: string; rule: Requirement["rule"] }) => RequirementSchema.parse({ id: "r", ...r });
const childReq = req({ predicate: "child.age_mention", rule: { op: "between", value: [12, 36], derived: "child.age_months" }, min_evidence: 2, max_evidence_age_days: 600 });

describe("testRule", () => {
  it("operadores básicos", () => {
    expect(testRule({ op: "eq", value: "garmin" }, "garmin")).toBe(true);
    expect(testRule({ op: "between", value: [12, 36] }, 25)).toBe(true);
    expect(testRule({ op: "between", value: [12, 36] }, 45)).toBe(false);
    expect(testRule({ op: "none_of", value: ["adult"] }, "none")).toBe(true);
    expect(testRule({ op: "contains", value: "a" }, ["a", "b"])).toBe(true);
  });
});

describe("evaluateRequirement con derivaciones y evidencia", () => {
  it("PASS con dos evidencias independientes de distintos predicados que derivan lo mismo", () => {
    const claims = [
      claim({ predicate_key: "child.age_mention", value: { amount: 6, unit: "months" }, observed_at: new Date("2025-03-14T00:00:00Z") }),
      claim({ predicate_key: "child.age_mention", value: { amount: 19, unit: "months" }, observed_at: new Date("2026-04-10T00:00:00Z") }),
    ];
    const r = evaluateRequirement(childReq, claims, ctx);
    expect(r.verdict).toBe("PASS");
    expect(r.values).toEqual([25, 25]);
  });
  it("UNKNOWN con una sola evidencia cuando se exigen dos", () => {
    const claims = [claim({ predicate_key: "child.age_mention", value: { amount: 15, unit: "months" }, observed_at: new Date("2026-09-01T00:00:00Z") })];
    const r = evaluateRequirement(childReq, claims, ctx);
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.reason).toMatch(/insuficiente \(1\/2\)/);
  });
  it("FAIL cuando la edad derivada queda fuera del rango", () => {
    const claims = [
      claim({ predicate_key: "child.age_mention", value: { amount: 3, unit: "years" }, observed_at: new Date("2026-01-10T00:00:00Z") }),
      claim({ predicate_key: "child.birth_event", value: { kind: "birth" }, observed_at: new Date("2026-09-01T00:00:00Z") }),
    ];
    expect(evaluateRequirement(childReq, claims, ctx).verdict).toBe("FAIL");
  });
  it("UNKNOWN sin claims", () => {
    expect(evaluateRequirement(childReq, [], ctx).verdict).toBe("UNKNOWN");
  });
  it("la evidencia vieja no cuenta", () => {
    const claims = [
      claim({ predicate_key: "child.age_mention", value: { amount: 1, unit: "months" }, observed_at: new Date("2024-01-01T00:00:00Z") }),
      claim({ predicate_key: "child.age_mention", value: { amount: 2, unit: "months" }, observed_at: new Date("2024-02-01T00:00:00Z") }),
    ];
    expect(evaluateRequirement(childReq, claims, ctx).verdict).toBe("UNKNOWN");
  });
  it("la confianza baja no cuenta salvo que sea humana", () => {
    const low = claim({ predicate_key: "wearable.brand", value: "garmin", confidence: 0.4 });
    const r1 = evaluateRequirement(req({ predicate: "wearable.brand", rule: { op: "eq", value: "garmin" } }), [low], ctx);
    expect(r1.verdict).toBe("UNKNOWN");
    const human = claim({ predicate_key: "wearable.brand", value: "garmin", confidence: 1, status: "human_confirmed", evidence_modality: "human" });
    const r2 = evaluateRequirement(req({ predicate: "wearable.brand", rule: { op: "eq", value: "garmin" } }), [low, human], ctx);
    expect(r2.verdict).toBe("PASS");
  });
  it("una evidencia fuerte más una de apoyo (hasta 0,1 bajo el umbral) completan min_evidence 2", () => {
    const r2 = req({ predicate: "content.category", rule: { op: "any_of", value: ["running"] }, min_evidence: 2 });
    const strong = claim({ predicate_key: "content.category", value: "running", confidence: 0.99, evidence_content_id: "p1" });
    const support = claim({ predicate_key: "content.category", value: "running", confidence: 0.8, evidence_content_id: "p2" });
    const weak = claim({ predicate_key: "content.category", value: "running", confidence: 0.6, evidence_content_id: "p3" });
    expect(evaluateRequirement(r2, [strong, support], ctx).verdict).toBe("PASS");
    expect(evaluateRequirement(r2, [strong, weak], ctx).verdict).toBe("UNKNOWN");      // 0,6 es demasiado bajo para apoyar
    expect(evaluateRequirement(r2, [support, support], ctx).verdict).toBe("UNKNOWN");  // sin ninguna fuerte, no cuentan
  });
  it("un predicado clasificado por Jev usa su propio umbral, más bajo", () => {
    const preds = predicates();
    preds.set("food.paisa", PredicateSchema.parse({ key: "food.paisa", label: "", tier: "micro", value_type: "boolean", temporal_kind: "slow", cardinality: "many", extraction_spec: { provider: "jev", modalities: ["caption"], jev: { type: "noul", instructions: "¿Comida paisa?", none_labels: [] } } }));
    const jctx = { ...ctx, predicates: preds, jevMinConfidence: 0.7 };
    const r1 = req({ predicate: "food.paisa", rule: { op: "eq", value: true }, min_evidence: 2 });
    const a = claim({ predicate_key: "food.paisa", value: true, confidence: 0.72, evidence_content_id: "p1" });
    const b = claim({ predicate_key: "food.paisa", value: true, confidence: 0.67, evidence_content_id: "p2" });
    expect(evaluateRequirement(r1, [a, b], jctx).verdict).toBe("PASS");     // 0,72 fuerte + 0,67 de apoyo con umbral 0,7
    expect(evaluateRequirement(r1, [a, b], ctx).verdict).toBe("UNKNOWN");   // con el umbral general (0,85) no cuentan
  });
  it("cardinalidad one: gana el claim humano sobre el automático más reciente", () => {
    const auto = claim({ predicate_key: "wearable.brand", value: "apple", observed_at: new Date("2026-10-01T00:00:00Z") });
    const human = claim({ predicate_key: "wearable.brand", value: "garmin", status: "human_confirmed", evidence_modality: "human", observed_at: new Date("2026-01-01T00:00:00Z") });
    const r = evaluateRequirement(req({ predicate: "wearable.brand", rule: { op: "eq", value: "garmin" } }), [auto, human], ctx);
    expect(r.verdict).toBe("PASS");
  });
  it("un denies más reciente fuerza FAIL", () => {
    const yes = claim({ predicate_key: "wearable.brand", value: "garmin", observed_at: new Date("2026-01-01T00:00:00Z") });
    const no = claim({ predicate_key: "wearable.brand", value: "garmin", polarity: "denies", observed_at: new Date("2026-06-01T00:00:00Z") });
    expect(evaluateRequirement(req({ predicate: "wearable.brand", rule: { op: "eq", value: "garmin" } }), [yes, no], ctx).verdict).toBe("FAIL");
  });
  it("misma evidencia (mismo post) cuenta una sola vez", () => {
    const post = "22222222-2222-2222-2222-aaaaaaaaaaaa";
    const claims = [
      claim({ predicate_key: "child.age_mention", value: { amount: 20, unit: "months" }, observed_at: new Date("2026-09-01T00:00:00Z"), evidence_content_id: post }),
      claim({ predicate_key: "child.age_mention", value: { amount: 20, unit: "months" }, observed_at: new Date("2026-09-01T00:00:00Z"), evidence_content_id: post }),
    ];
    expect(evaluateRequirement(childReq, claims, ctx).verdict).toBe("UNKNOWN");
  });
});

describe("evaluateCreator", () => {
  const spec = BriefSpecSchema.parse({
    title: "t",
    requirements: [
      { id: "hijo", predicate: "child.age_mention", rule: { op: "between", value: [12, 36], derived: "child.age_months" }, hard: true, min_evidence: 1 },
      { id: "cat", predicate: "content.category", rule: { op: "eq", value: "maternidad" }, hard: false, weight: 0.6 },
      { id: "aud", predicate: "audience.gender_female_pct", rule: { op: "gte", value: 60 }, hard: false, weight: 0.4 },
    ],
  });
  it("corroboración: con un duro probado, otro duro con una sola evidencia fuerte pasa", () => {
    const spec = BriefSpecSchema.parse({ title: "t", requirements: [
      { id: "edad", predicate: "child.age_mention", rule: { op: "between", value: [0, 60], derived: "child.age_months" }, hard: true, min_evidence: 1, max_evidence_age_days: 600 },
      { id: "rutina", predicate: "content.category", rule: { op: "any_of", value: ["maternidad"] }, hard: true, min_evidence: 2 },
    ] });
    const age = claim({ predicate_key: "child.age_mention", value: { amount: 8, unit: "months" }, observed_at: new Date("2026-09-01T00:00:00Z"), evidence_content_id: "p1" });
    const one = claim({ predicate_key: "content.category", value: "maternidad", confidence: 0.95, evidence_content_id: "p2" });
    expect(evaluateCreator(spec, [age, one], ctx).overall).toBe("PASS");       // edad probada + una evidencia de rutina
    expect(evaluateCreator(spec, [one], ctx).overall).toBe("UNKNOWN");         // sin el duro probado, sigue exigiendo dos
  });
  it("overall PASS y score ponderado de blandos", () => {
    const claims = [
      claim({ predicate_key: "child.age_mention", value: { amount: 20, unit: "months" }, observed_at: new Date("2026-09-01T00:00:00Z") }),
      claim({ predicate_key: "content.category", value: "maternidad" }),
    ];
    const e = evaluateCreator(spec, claims, ctx);
    expect(e.overall).toBe("PASS");
    expect(e.score).toBe(0.6);
  });
  it("un duro UNKNOWN deja overall UNKNOWN; un duro FAIL, FAIL", () => {
    expect(evaluateCreator(spec, [claim({ predicate_key: "content.category", value: "maternidad" })], ctx).overall).toBe("UNKNOWN");
    const old = claim({ predicate_key: "child.age_mention", value: { amount: 10, unit: "years" }, observed_at: new Date("2026-09-01T00:00:00Z") });
    expect(evaluateCreator(spec, [old], ctx).overall).toBe("FAIL");
  });
});
