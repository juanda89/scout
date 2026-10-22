import { db } from "../db.js";

export interface JobKey { creatorId: string; predicateKey: string; version: number; scope: string; provider: string }

export function idempotencyKey(k: JobKey): string {
  return `${k.creatorId}:${k.predicateKey}:v${k.version}:${k.scope}`;
}

/** Devuelve true si ya existe un job terminado con esa clave (es decir, ya miramos ese contenido para ese predicado). */
export async function isCovered(k: JobKey): Promise<boolean> {
  const { rowCount } = await db().query(`SELECT 1 FROM extraction_jobs WHERE idempotency_key = $1 AND status = 'done'`, [idempotencyKey(k)]);
  return !!rowCount;
}

export async function recordJob(k: JobKey, status: "done" | "failed" | "skipped", costUsd: number, error?: string): Promise<void> {
  await db().query(
    `INSERT INTO extraction_jobs (creator_id, predicate_key, content_scope, provider, status, cost_usd, idempotency_key, error, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status, cost_usd = EXCLUDED.cost_usd, error = EXCLUDED.error, finished_at = now()`,
    [k.creatorId, k.predicateKey, JSON.stringify({ scope: k.scope }), k.provider, status, costUsd, idempotencyKey(k), error ?? null],
  );
}
