import { z } from "zod/v4";
import { llm } from "../llm/client.js";

/** Mapa alpha-2 -> alpha-3 para cruzar el brief (alpha-2) con CreatorDB (alpha-3). */
export const A2_TO_A3: Record<string, string> = {
  ES: "ESP", MX: "MEX", CO: "COL", AR: "ARG", CL: "CHL", PE: "PER", US: "USA", BR: "BRA", EC: "ECU", VE: "VEN", UY: "URY", PY: "PRY", BO: "BOL",
  GT: "GTM", CR: "CRI", PA: "PAN", DO: "DOM", HN: "HND", SV: "SLV", NI: "NIC", CU: "CUB", PR: "PRI", PT: "PRT", FR: "FRA", IT: "ITA", DE: "DEU", GB: "GBR", CA: "CAN",
};
export const A3_TO_A2: Record<string, string> = Object.fromEntries(Object.entries(A2_TO_A3).map(([a2, a3]) => [a3, a2]));
export const LATAM_A2 = ["MX", "CO", "AR", "CL", "PE", "EC", "VE", "UY", "PY", "BO", "GT", "CR", "PA", "DO", "HN", "SV", "NI", "CU", "PR", "BR"];

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
    total += pct * (overlap / (b - a + 1));
  }
  return Number(total.toFixed(1));
}

/** Normaliza nombres de ciudad para comparar: minúsculas, sin acentos, sin puntuación. */
export function normCity(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Expansión geográfica del brief: "Antioquia" -> todos sus municipios, "Eje Cafetero" -> sus ciudades,
 * "Latinoamérica" -> todos los países. El nivel decide si la ciudad es filtro duro (city/region) o solo el país.
 */
export const GeoScopeSchema = z.object({
  level: z.enum(["city", "region", "country", "multi_country", "unknown"]),
  label: z.string(),
  countries: z.array(z.string()),
  /** Ciudades y municipios incluidos (nombres oficiales, sin país). Vacío si level es country o multi_country. */
  cities: z.array(z.string()),
  /** Palabras clave de lugar para buscar (ciudades principales, gentilicios, abreviaturas: "medellin", "paisa", "mde"). */
  search_terms: z.array(z.string()),
});
export type GeoScope = z.infer<typeof GeoScopeSchema>;

export async function expandLocation(location: string, countries: string[]): Promise<GeoScope> {
  const fallback: GeoScope = { level: location ? "city" : countries.length > 1 ? "multi_country" : countries.length ? "country" : "unknown", label: location || countries.join(", "), countries, cities: location ? location.split(/[,&]|\by\b|\band\b/i).map((s) => s.replace(/\(.*\)/, "").trim()).filter(Boolean) : [], search_terms: location ? [normCity(location)] : [] };
  const client = llm("reasoning");
  if (!client || !location) return fallback;
  try {
    const r = await client.complete({
      system: `Eres un experto en geografía de Latinoamérica y España. Dada la ubicación de un brief, devuelve su alcance geográfico completo.
Reglas: si es una ciudad, level=city y cities=[esa ciudad y su área metropolitana, ej. Medellín incluye Envigado, Itagüí, Bello, Sabaneta, La Estrella].
Si es un departamento, estado o región (Antioquia, Eje Cafetero, Cataluña, Bajío), level=region y cities=TODOS sus municipios o ciudades relevantes (hasta 120).
Si es un país, level=country y cities=[]. Si es un conjunto de países (Latinoamérica, LatAm, Cono Sur, Centroamérica), level=multi_country, countries=todos los países ISO alpha-2 del conjunto y cities=[].
countries siempre en ISO alpha-2. search_terms: 5 a 12 términos cortos con los que la gente de esa zona se identifica en handles, bios y hashtags: ciudades principales, gentilicios (paisa, rolo, caleño), abreviaturas y apodos locales (mde, medallo, bog, cdmx, gdl, bue). Pon primero los más específicos de la zona; evita términos ambiguos de otro lugar.`,
      user: JSON.stringify({ location, countries_hint: countries }), schema: GeoScopeSchema, schemaName: "geo_scope", maxTokens: 4000,
    });
    const g = r.data;
    const cs = g.countries.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
    return { ...g, countries: cs.length ? cs : countries, cities: [...new Set(g.cities.map((c) => c.trim()).filter(Boolean))] };
  } catch (e) {
    console.warn(`[geo] expansión fallida, uso fallback: ${e instanceof Error ? e.message : e}`);
    return fallback;
  }
}
