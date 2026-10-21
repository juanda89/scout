import type { Claim } from "../schema/claim.js";
import type { Derivation, Predicate } from "../schema/predicate.js";

/** Meses completos entre dos fechas (determinista, sin zonas horarias raras: usa UTC). */
export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

function ageMentionToMonths(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { amount?: unknown; unit?: unknown };
  if (typeof v.amount !== "number") return null;
  if (v.unit === "months") return v.amount;
  if (v.unit === "years") return v.amount * 12;
  if (v.unit === "weeks") return Math.floor(v.amount / 4.345);
  if (v.unit === "days") return Math.floor(v.amount / 30.44);
  return null;
}

/**
 * Aplica una derivación a un claim y devuelve el hecho virtual, o null si no aplica.
 * Todas las funciones son puras y dependen solo del claim y de `now`.
 */
export function derive(d: Derivation, claim: Claim, now: Date): number | string | null {
  switch (d.fn) {
    case "months_since_observed": {
      // Evento con fecha = observed_at (ej. anuncio de nacimiento). Edad actual en meses.
      if (!claim.observed_at) return null;
      return monthsBetween(claim.observed_at, now);
    }
    case "months_since_observed_plus_age": {
      // Mención de edad en el post ("mi bebé de 6 meses") -> edad hoy = 6 + meses transcurridos.
      if (!claim.observed_at) return null;
      const base = ageMentionToMonths(claim.value);
      if (base === null) return null;
      return base + monthsBetween(claim.observed_at, now);
    }
    case "years_since_observed_plus_age": {
      if (!claim.observed_at) return null;
      const base = ageMentionToMonths(claim.value);
      if (base === null) return null;
      return Math.floor((base + monthsBetween(claim.observed_at, now)) / 12);
    }
    case "value_field": {
      const field = String(d.params.field ?? "");
      const v = (claim.value as Record<string, unknown> | null)?.[field];
      return typeof v === "number" || typeof v === "string" ? v : null;
    }
  }
}

/** Predicados que declaran una derivación con ese nombre. */
export function predicatesProviding(derivedName: string, predicates: Map<string, Predicate>): Predicate[] {
  return [...predicates.values()].filter((p) => p.derivations.some((d) => d.name === derivedName));
}
