/** Mapa alpha-2 -> alpha-3 para cruzar el brief (alpha-2) con CreatorDB (alpha-3). */
export const A2_TO_A3: Record<string, string> = {
  ES: "ESP", MX: "MEX", CO: "COL", AR: "ARG", CL: "CHL", PE: "PER", US: "USA", BR: "BRA", EC: "ECU", VE: "VEN", UY: "URY", PY: "PRY", BO: "BOL",
  GT: "GTM", CR: "CRI", PA: "PAN", DO: "DOM", HN: "HND", SV: "SLV", NI: "NIC", CU: "CUB", PR: "PRI", PT: "PRT", FR: "FRA", IT: "ITA", DE: "DEU", GB: "GBR", CA: "CAN",
};
export const A3_TO_A2: Record<string, string> = Object.fromEntries(Object.entries(A2_TO_A3).map(([a2, a3]) => [a3, a2]));

/** Porcentaje de audiencia dentro de los países objetivo. */
export function audienceInCountries(locations: Record<string, number> | null, countries: string[]): number | null {
  if (!locations || !countries.length) return null;
  const targets = new Set(countries.map((c) => A2_TO_A3[c] ?? c));
  return Number(Object.entries(locations).filter(([k]) => targets.has(k)).reduce((a, [, v]) => a + v, 0).toFixed(1));
}

/** Porcentaje de audiencia dentro del rango de edad, prorrateando los buckets parcialmente cubiertos. */
export function audienceInAgeRange(ages: Record<string, number> | null, min: number | null, max: number | null): number | null {
  if (!ages || (min == null && max == null)) return null;
  const lo = min ?? 0, hi = max ?? 120;
  let total = 0;
  for (const [range, pct] of Object.entries(ages)) {
    const m = range.match(/^(\d+)(?:-(\d+)|\+)$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : 99;
    const overlap = Math.max(0, Math.min(b, hi) - Math.max(a, lo) + 1);
    const width = b - a + 1;
    total += pct * (overlap / width);
  }
  return Number(total.toFixed(1));
}
