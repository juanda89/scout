import { describe, expect, it } from "vitest";
import { computeFit, erBenchmark } from "../src/scouting/fit.js";

const base = { verdict: "PASS" as const, topicShare: 0.9, audienceLocationPct: 80, audienceAgePct: 70, followers: 50_000, er: 0.045, minEngagementPct: 3, brandSafetyFlags: [] as string[] };

describe("computeFit", () => {
  it("candidata fuerte da fit alto y tier excelente", () => {
    const r = computeFit(base);
    expect(r.fit).toBeGreaterThanOrEqual(90);
    expect(r.tier).toBe("excellent");
    expect(r.parts.brand_safety).toBe(100);
    expect(Object.keys(r.parts)).toEqual(["topic", "audience", "engagement", "brand_safety"]);
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
  it("UNKNOWN en el requisito duro baja topic a la mitad", () => {
    const pass = computeFit(base).parts.topic, unk = computeFit({ ...base, verdict: "UNKNOWN" }).parts.topic;
    expect(unk).toBeLessThan(pass);
    expect(unk).toBeGreaterThan(0);
  });
  it("benchmark de engagement por tamaño", () => {
    expect(erBenchmark(5_000)).toBe(0.05);
    expect(erBenchmark(1_000_000)).toBe(0.015);
  });
  it("el presupuesto no cambia el fit", () => {
    expect(computeFit(base).fit).toBe(computeFit({ ...base }).fit);
  });
});
