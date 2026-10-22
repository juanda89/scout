import { db } from "../db.js";
import { BriefSpecSchema, type BriefSpec } from "../schema/brief.js";
import { upsertPredicate } from "../registry/registry.js";

export async function createBrief(title: string, rawText: string): Promise<string> {
  const { rows } = await db().query(`INSERT INTO briefs (title, raw_text) VALUES ($1,$2) RETURNING id`, [title, rawText]);
  return rows[0].id;
}

export async function saveSpec(briefId: string, spec: BriefSpec, compiledBy: Record<string, unknown>): Promise<{ id: string; version: number }> {
  const { rows: v } = await db().query(`SELECT COALESCE(MAX(version),0)+1 AS next FROM brief_specs WHERE brief_id = $1`, [briefId]);
  const version = Number(v[0].next);
  const { rows } = await db().query(
    `INSERT INTO brief_specs (brief_id, version, spec, compiled_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [briefId, version, JSON.stringify(spec), JSON.stringify(compiledBy)],
  );
  return { id: rows[0].id, version };
}

export interface StoredSpec { id: string; brief_id: string; version: number; spec: BriefSpec; approved_by: string | null }

export async function getSpec(briefId: string, opts: { version?: number; approvedOnly?: boolean } = {}): Promise<StoredSpec | null> {
  const params: unknown[] = [briefId];
  let sql = `SELECT id, brief_id, version, spec, approved_by FROM brief_specs WHERE brief_id = $1`;
  if (opts.version) { params.push(opts.version); sql += ` AND version = $2`; }
  if (opts.approvedOnly) sql += ` AND approved_at IS NOT NULL`;
  sql += ` ORDER BY version DESC LIMIT 1`;
  const { rows } = await db().query(sql, params);
  if (!rows[0]) return null;
  return { ...rows[0], spec: BriefSpecSchema.parse(rows[0].spec) };
}

/** Aprobar una spec registra sus predicados nuevos en el registro y la marca como ejecutable. */
export async function approveSpec(specId: string, approvedBy: string): Promise<string[]> {
  const { rows } = await db().query(`SELECT brief_id, spec FROM brief_specs WHERE id = $1`, [specId]);
  if (!rows[0]) throw new Error("spec no encontrada");
  const spec = BriefSpecSchema.parse(rows[0].spec);
  const registered: string[] = [];
  for (const np of spec.new_predicates) {
    await upsertPredicate({ ...np, created_from_brief: rows[0].brief_id });
    registered.push(np.key);
  }
  await db().query(`UPDATE brief_specs SET approved_by = $2, approved_at = now() WHERE id = $1`, [specId, approvedBy]);
  return registered;
}

export async function resolveBriefId(idOrTitle: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/i.test(idOrTitle)) return idOrTitle;
  const { rows } = await db().query(`SELECT id FROM briefs WHERE title ILIKE $1 ORDER BY created_at DESC LIMIT 1`, [`%${idOrTitle}%`]);
  if (!rows[0]) throw new Error(`brief no encontrado: ${idOrTitle}`);
  return rows[0].id;
}
