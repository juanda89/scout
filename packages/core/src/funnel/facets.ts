import { db } from "../db.js";
import { config } from "../config.js";
import { listClaims } from "../extract/claims.js";
import { listPredicates } from "../registry/registry.js";
import { byPriority, vigentes } from "../rules/resolve.js";
import { normCity } from "../scouting/geo.js";

/** Recalcula la fila de creator_facets de una creadora a partir de sus claims macro vigentes. */
export async function refreshFacets(creatorId: string): Promise<Record<string, unknown[]>> {
  const macro = await listPredicates("macro");
  const claims = vigentes(await listClaims(creatorId, macro.map((p) => p.key)), { now: new Date(), minConfidence: config.defaultMinConfidence })
    .filter((c) => c.polarity === "affirms")
    .sort(byPriority);
  const facets: Record<string, unknown[]> = {};
  for (const p of macro) {
    const mine = claims.filter((c) => c.predicate_key === p.key);
    if (!mine.length) continue;
    if (p.key === "location.city") {
      // Todas las ciudades con evidencia (bio, geotags), normalizadas para comparar sin acentos ni mayúsculas.
      facets[p.key] = [...new Set(mine.map((c) => normCity(String(c.value))).filter(Boolean))];
      continue;
    }
    facets[p.key] = p.cardinality === "one" ? [mine[0].value] : [...new Set(mine.map((c) => JSON.stringify(c.value)))].map((v) => JSON.parse(v));
  }
  const { rows } = await db().query(`SELECT followers, er_estimate FROM creator_metrics_snapshots WHERE creator_id = $1 ORDER BY taken_at DESC LIMIT 1`, [creatorId]);
  await db().query(
    `INSERT INTO creator_facets (creator_id, followers, er_estimate, facets, refreshed_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (creator_id) DO UPDATE SET followers = EXCLUDED.followers, er_estimate = EXCLUDED.er_estimate, facets = EXCLUDED.facets, refreshed_at = now()`,
    [creatorId, rows[0]?.followers ?? null, rows[0]?.er_estimate ?? null, JSON.stringify(facets)],
  );
  return facets;
}
