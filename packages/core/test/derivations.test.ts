import { describe, expect, it } from "vitest";
import { derive, monthsBetween } from "../src/rules/derivations.js";
import { claim, NOW } from "./helpers.js";

describe("monthsBetween", () => {
  it("cuenta meses completos", () => {
    expect(monthsBetween(new Date("2025-03-14T00:00:00Z"), NOW)).toBe(19);
    expect(monthsBetween(new Date("2026-09-30T00:00:00Z"), NOW)).toBe(0);
    expect(monthsBetween(new Date("2026-10-21T00:00:00Z"), NOW)).toBe(0);
  });
});

describe("derive", () => {
  it("edad hoy = edad mencionada + meses transcurridos", () => {
    const c = claim({ predicate_key: "child.age_mention", value: { amount: 6, unit: "months" }, observed_at: new Date("2025-03-14T00:00:00Z") });
    expect(derive({ name: "child.age_months", fn: "months_since_observed_plus_age", params: {} }, c, NOW)).toBe(25);
  });
  it("años se convierten a meses", () => {
    const c = claim({ predicate_key: "child.age_mention", value: { amount: 3, unit: "years" }, observed_at: new Date("2026-01-10T00:00:00Z") });
    expect(derive({ name: "child.age_months", fn: "months_since_observed_plus_age", params: {} }, c, NOW)).toBe(45);
  });
  it("evento de nacimiento: meses desde el post", () => {
    const c = claim({ predicate_key: "child.birth_event", value: { kind: "birth" }, observed_at: new Date("2026-09-01T00:00:00Z") });
    expect(derive({ name: "child.age_months", fn: "months_since_observed", params: {} }, c, NOW)).toBe(1);
  });
  it("sin fecha de observación no deriva", () => {
    const c = claim({ predicate_key: "child.birth_event", value: { kind: "birth" }, observed_at: null });
    expect(derive({ name: "child.age_months", fn: "months_since_observed", params: {} }, c, NOW)).toBeNull();
  });
});
