import { db } from "../db.js";
import { ClaimSchema, type Claim, type NewClaim } from "../schema/claim.js";

export async function insertClaims(claims: NewClaim[]): Promise<number> {
  if (!claims.length) return 0;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    for (const c of claims) {
      await client.query(
        `INSERT INTO claims (creator_id, predicate_key, predicate_version, value, polarity, observed_at, evidence_content_id, evidence_span, evidence_modality, confidence, extractor, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'auto')`,
        [c.creator_id, c.predicate_key, c.predicate_version, JSON.stringify(c.value), c.polarity, c.observed_at, c.evidence_content_id, c.evidence_span, c.evidence_modality, c.confidence, c.extractor],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return claims.length;
}

export async function listClaims(creatorId: string, predicateKeys?: string[]): Promise<Claim[]> {
  const { rows } = predicateKeys?.length
    ? await db().query(`SELECT * FROM claims WHERE creator_id = $1 AND predicate_key = ANY($2) ORDER BY created_at`, [creatorId, predicateKeys])
    : await db().query(`SELECT * FROM claims WHERE creator_id = $1 ORDER BY created_at`, [creatorId]);
  return rows.map((r) => ClaimSchema.parse(r));
}

export async function listClaimsForCreators(creatorIds: string[], predicateKeys: string[]): Promise<Map<string, Claim[]>> {
  const map = new Map<string, Claim[]>();
  if (!creatorIds.length) return map;
  const { rows } = await db().query(
    `SELECT * FROM claims WHERE creator_id = ANY($1) AND predicate_key = ANY($2) ORDER BY created_at`,
    [creatorIds, predicateKeys],
  );
  for (const r of rows) {
    const c = ClaimSchema.parse(r);
    const arr = map.get(c.creator_id) ?? [];
    arr.push(c);
    map.set(c.creator_id, arr);
  }
  return map;
}

/**
 * Decisión humana como claim. Si rechaza, los claims automáticos del predicado quedan supersedidos
 * por el claim humano (no se borran: historial completo).
 */
export async function insertHumanClaim(opts: {
  creatorId: string; predicateKey: string; value: unknown; polarity: "affirms" | "denies"; reviewer: string; note?: string; supersedeAuto?: boolean;
}): Promise<string> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO claims (creator_id, predicate_key, value, polarity, observed_at, evidence_modality, confidence, extractor, status, evidence_span)
       VALUES ($1,$2,$3,$4,now(),'human',1,$5,'human_confirmed',$6) RETURNING id`,
      [opts.creatorId, opts.predicateKey, JSON.stringify(opts.value), opts.polarity, JSON.stringify({ reviewer: opts.reviewer }), opts.note ?? null],
    );
    const id = rows[0].id as string;
    if (opts.supersedeAuto) {
      await client.query(
        `UPDATE claims SET status = 'superseded', superseded_by = $1 WHERE creator_id = $2 AND predicate_key = $3 AND status = 'auto'`,
        [id, opts.creatorId, opts.predicateKey],
      );
    }
    await client.query("COMMIT");
    return id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Consulta transversal: creadoras con un claim vigente de un predicado (y opcionalmente valor). */
export async function queryClaims(predicateKey: string, value?: unknown, minConfidence = 0.85): Promise<Array<{ handle: string; value: unknown; confidence: number; status: string; observed_at: Date | null }>> {
  const params: unknown[] = [predicateKey, minConfidence];
  let sql = `SELECT c.value, c.confidence, c.status, c.observed_at, cr.handle
             FROM claims c JOIN creators cr ON cr.id = c.creator_id
             WHERE c.predicate_key = $1 AND c.status IN ('auto','human_confirmed') AND c.polarity = 'affirms'
               AND (c.confidence >= $2 OR c.status = 'human_confirmed')`;
  if (value !== undefined) { params.push(JSON.stringify(value)); sql += ` AND c.value = $3::jsonb`; }
  sql += ` ORDER BY cr.handle, c.observed_at DESC`;
  const { rows } = await db().query(sql, params);
  return rows;
}
