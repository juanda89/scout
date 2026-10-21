import { db } from "../db.js";
import { PredicateSchema, type Predicate, type PredicateInput } from "../schema/predicate.js";
import { SEED_PREDICATES } from "./seed.js";

function rowToPredicate(r: Record<string, unknown>): Predicate {
  return PredicateSchema.parse(r);
}

export async function upsertPredicate(input: PredicateInput): Promise<Predicate> {
  const p = PredicateSchema.parse(input);
  const { rows } = await db().query(
    `INSERT INTO predicates (key, label, tier, value_type, value_schema, temporal_kind, cardinality, extraction_spec, derivations, created_from_brief, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (key) DO UPDATE SET
       label = EXCLUDED.label, tier = EXCLUDED.tier, value_type = EXCLUDED.value_type,
       value_schema = EXCLUDED.value_schema, temporal_kind = EXCLUDED.temporal_kind,
       cardinality = EXCLUDED.cardinality, extraction_spec = EXCLUDED.extraction_spec,
       derivations = EXCLUDED.derivations,
       version = CASE WHEN predicates.value_schema IS DISTINCT FROM EXCLUDED.value_schema
                        OR predicates.extraction_spec IS DISTINCT FROM EXCLUDED.extraction_spec
                      THEN predicates.version + 1 ELSE predicates.version END
     RETURNING *`,
    [p.key, p.label, p.tier, p.value_type, p.value_schema, p.temporal_kind, p.cardinality,
     p.extraction_spec, JSON.stringify(p.derivations), p.created_from_brief ?? null, p.version],
  );
  return rowToPredicate(rows[0]);
}

export async function getPredicate(key: string): Promise<Predicate | null> {
  const { rows } = await db().query(`SELECT * FROM predicates WHERE key = $1`, [key]);
  return rows[0] ? rowToPredicate(rows[0]) : null;
}

export async function listPredicates(tier?: "macro" | "micro"): Promise<Predicate[]> {
  const { rows } = tier
    ? await db().query(`SELECT * FROM predicates WHERE tier = $1 ORDER BY key`, [tier])
    : await db().query(`SELECT * FROM predicates ORDER BY tier, key`);
  return rows.map(rowToPredicate);
}

export async function predicateMap(): Promise<Map<string, Predicate>> {
  return new Map((await listPredicates()).map((p) => [p.key, p]));
}

export async function seedRegistry(): Promise<number> {
  let n = 0;
  for (const p of SEED_PREDICATES) { await upsertPredicate(p); n++; }
  return n;
}

/**
 * Busca predicados existentes que podrían cubrir un requisito nuevo.
 * Heurística determinista: coincidencia de tokens en key, label y valores enum.
 * El compilador la usa para preferir reutilizar antes de crear.
 */
export function findSimilarPredicates(all: Predicate[], query: string, limit = 5): Predicate[] {
  const tokens = tokenize(query);
  const scored = all.map((p) => {
    const hay = new Set([...tokenize(p.key.replace(/[._]/g, " ")), ...tokenize(p.label), ...tokenize(JSON.stringify(p.value_schema.values ?? ""))]);
    const score = tokens.reduce((acc, t) => acc + (hay.has(t) ? 1 : 0), 0);
    return { p, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.p);
}

function tokenize(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}
