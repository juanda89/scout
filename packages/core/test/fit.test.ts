import { describe, expect, it } from "vitest";
import { computeFit, erBenchmark, estimateRateUsd } from "../src/scouting/fit.js";

const base = { verdict: "PASS" as const, topicShare: 0.9, audienceLocationPct: 80, audienceAgePct: 70, followers: 50_000, er: 0.045, minEngagementPct: 3, brandSafetyFlags: [] as string[], estimatedRateUsd: 500, budgetPerCreatorUsd: 700 };

describe("computeFit", () => {
  it("candidata fuerte da fit alto y tier excelente", () => {
    const r = computeFit(base);
    expect(r.fit).toBeGreaterThanOrEqual(90);
    expect(r.tier).toBe("excellent");
    expect(r.parts.brand_safety).toBe(100);
    expect(r.parts.rate_vs_budget).toBe(100);
  });
  it("sin dato de audiencia queda en 50, no en 0", () => {
    const r = computeFit({ ...base, audienceLocationPct: null, audienceAgePct: null });
    expect(r.parts.audience).toBe(50);
  });
  it("un flag grave anula brand safety y hunde el fit", () => {
    const r = computeFit({ ...base, brandSafetyFlags: ["adult"] });
    expect(r.parts.brand_safety).toBe(0);
    expect(r.fit).toBeLessThan(computeFit(base).fit);
  });
  it("tarifa que dobla el presupuesto da 0 en rate", () => {
    expect(computeFit({ ...base, estimatedRateUsd: 1500, budgetPerCreatorUsd: 700 }).parts.rate_vs_budget).toBe(0);
  });
  it("UNKNOWN en el requisito duro baja topic a la mitad", () => {
    const pass = computeFit(base).parts.topic, unk = computeFit({ ...base, verdict: "UNKNOWN" }).parts.topic;
    expect(unk).toBeLessThan(pass);
    expect(unk).toBeGreaterThan(0);
  });
  it("benchmark y tarifa por tamaño", () => {
    expect(erBenchmark(5_000)).toBe(0.05);
    expect(erBenchmark(1_000_000)).toBe(0.015);
    expect(estimateRateUsd(50_000, "instagram")).toBe(250);          // mercado desconocido: 5 USD por mil
    expect(estimateRateUsd(50_000, "instagram", "US")).toBe(500);    // 10 USD por mil
    expect(estimateRateUsd(300_000, "instagram", "CO")).toBe(900);   // 3 USD por mil
    expect(estimateRateUsd(null, "instagram")).toBeNull();
  });
});
