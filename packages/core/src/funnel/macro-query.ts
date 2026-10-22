import { db } from "../db.js";
import type { BriefSpec } from "../schema/brief.js";
import { NUMERIC_FACETS } from "../brief/validate.js";

export interface Candidate { id: string; handle: string; platform: string; followers: number | null; er_estimate: number | null; facets: Record<string, unknown[]> }

/**
 * Traduce macro_filters a SQL sobre creator_facets. Determinista: sin faceta = sin evidencia = no candidata
 * (salvo none_of, donde la ausencia de la faceta cuenta como "no tiene ese valor").
 */
export function buildMacroWhere(filters: BriefSpec["macro_filters"]): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  for (const [key, f] of Object.entries(filters)) {
    if (NUMERIC_FACETS.has(key)) {
      if (f.between) clauses.push(`f.${key} BETWEEN ${add(f.between[0])} AND ${add(f.between[1])}`);
      if (f.gte !== undefined) clauses.push(`f.${key} >= ${add(f.gte)}`);
      if (f.lte !== undefined) clauses.push(`f.${key} <= ${add(f.lte)}`);
      continue;
    }
    const col = `f.facets -> ${add(key)}`;
    if (f.eq !== undefined) clauses.push(`${col} @> ${add(JSON.stringify([f.eq]))}::jsonb`);
    if (f.any_of?.length) clauses.push(`(${f.any_of.map((v) => `${col} @> ${add(JSON.stringify([v]))}::jsonb`).join(" OR ")})`);
    if (f.none_of?.length) clauses.push(`NOT (${f.none_of.map((v) => `COALESCE(${col} @> ${add(JSON.stringify([v]))}::jsonb, false)`).join(" OR ")})`);
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "true", params };
}

export async function macroCandidates(filters: BriefSpec["macro_filters"], opts: { platforms?: string[] } = {}): Promise<Candidate[]> {
  const { sql, params } = buildMacroWhere(filters);
  let extra = "";
  if (opts.platforms?.length) { params.push(opts.platforms); extra = ` AND c.platform = ANY($${params.length})`; }
  const { rows } = await db().query(
    `SELECT c.id, c.handle, c.platform, f.followers, f.er_estimate, f.facets
     FROM creator_facets f JOIN creators c ON c.id = f.creator_id
     WHERE ${sql}${extra} ORDER BY f.followers DESC NULLS LAST`,
    params,
  );
  return rows as Candidate[];
}
