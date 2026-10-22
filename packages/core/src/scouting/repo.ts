import { db } from "../db.js";
import { ScoutingFieldsSchema, type FieldSource, type Scouting, type ScoutingEvent, type ScoutingFields, type ScoutingMetrics, type ScoutingResult, type ScoutingStatus, type Span } from "./types.js";

function row(r: Record<string, unknown>): Scouting {
  return {
    ...(r as unknown as Scouting),
    fields: ScoutingFieldsSchema.parse(r.fields ?? {}),
    stage_progress: Number(r.stage_progress ?? 0),
  };
}

export async function createScouting(input: { ownerId: number | null; name: string; description: string; fields: ScoutingFields; fieldSources: Record<string, FieldSource>; spans: Span[]; notifyEmail?: boolean }): Promise<Scouting> {
  const { rows } = await db().query(
    `INSERT INTO scoutings (owner_id, name, description, fields, field_sources, spans, notify_email) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.ownerId, input.name, input.description, JSON.stringify(input.fields), JSON.stringify(input.fieldSources), JSON.stringify(input.spans), input.notifyEmail ?? true],
  );
  for (let n = 1; n <= 5; n++) await db().query(`INSERT INTO scouting_stages (scouting_id, n) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rows[0].id, n]);
  return row(rows[0]);
}

export async function getScouting(id: string): Promise<Scouting | null> {
  const { rows } = await db().query(`SELECT * FROM scoutings WHERE id = $1`, [id]);
  return rows[0] ? row(rows[0]) : null;
}

export async function updateScouting(id: string, patch: Partial<{ name: string; status: ScoutingStatus; fields: ScoutingFields; field_sources: Record<string, FieldSource>; spans: Span[]; brief_id: string; spec_id: string; run_id: string; stage: number; stage_progress: number; metrics: ScoutingMetrics; notify_email: boolean; error: string | null; started_at: Date; finished_at: Date }>): Promise<void> {
  const sets: string[] = ["updated_at = now()"]; const params: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    params.push(["fields", "field_sources", "spans", "metrics"].includes(k) ? JSON.stringify(v) : v);
    sets.push(`${k} = $${params.length}`);
  }
  await db().query(`UPDATE scoutings SET ${sets.join(", ")} WHERE id = $1`, params);
}

export async function mergeMetrics(id: string, m: ScoutingMetrics): Promise<void> {
  await db().query(`UPDATE scoutings SET metrics = metrics || $2::jsonb, updated_at = now() WHERE id = $1`, [id, JSON.stringify(m)]);
}

export interface ScoutingListItem extends Scouting {
  creators_count: number; avg_fit: number | null; best_fit: number | null; top_names: string[];
}

export async function listScoutings(ownerId: number | null): Promise<ScoutingListItem[]> {
  const { rows } = await db().query(
    `SELECT s.*,
            COALESCE(a.n, 0) AS creators_count, a.avg_fit, a.best_fit,
            COALESCE((SELECT array_agg(COALESCE(c.display_name, c.handle) ORDER BY r.rank) FROM (SELECT * FROM scouting_results WHERE scouting_id = s.id ORDER BY rank LIMIT 3) r JOIN creators c ON c.id = r.creator_id), '{}') AS top_names
     FROM scoutings s
     LEFT JOIN (SELECT scouting_id, count(*) AS n, round(avg(fit)) AS avg_fit, max(fit) AS best_fit FROM scouting_results WHERE NOT preliminary GROUP BY scouting_id) a ON a.scouting_id = s.id
     WHERE ($1::integer IS NULL OR s.owner_id = $1) AND s.status <> 'draft'
     ORDER BY (s.status IN ('running','queued')) DESC, s.created_at DESC`,
    [ownerId],
  );
  return rows.map((r) => ({ ...row(r), creators_count: Number(r.creators_count), avg_fit: r.avg_fit == null ? null : Number(r.avg_fit), best_fit: r.best_fit == null ? null : Number(r.best_fit), top_names: r.top_names ?? [] }));
}

export async function setStage(id: string, n: number, status: "running" | "done" | "failed", detail?: string): Promise<void> {
  await db().query(
    `UPDATE scouting_stages SET status = $3, detail = COALESCE($4, detail),
       started_at = CASE WHEN $3 = 'running' THEN now() ELSE started_at END,
       finished_at = CASE WHEN $3 IN ('done','failed') THEN now() ELSE finished_at END
     WHERE scouting_id = $1 AND n = $2`, [id, n, status, detail ?? null]);
  if (status === "running") await updateScouting(id, { stage: n, stage_progress: 0 });
  if (status === "done") await updateScouting(id, { stage_progress: 1 });
}

export async function listStages(id: string): Promise<Array<{ n: number; status: string; detail: string | null; started_at: Date | null; finished_at: Date | null }>> {
  const { rows } = await db().query(`SELECT n, status, detail, started_at, finished_at FROM scouting_stages WHERE scouting_id = $1 ORDER BY n`, [id]);
  return rows;
}

export async function addEvent(id: string, stage: number | null, text: string, kind = "info", data?: unknown): Promise<void> {
  await db().query(`INSERT INTO scouting_events (scouting_id, stage, kind, text, data) VALUES ($1,$2,$3,$4,$5)`, [id, stage, kind, text, data === undefined ? null : JSON.stringify(data)]);
}

export async function listEvents(id: string, afterId = 0, limit = 50): Promise<ScoutingEvent[]> {
  const { rows } = await db().query(`SELECT * FROM scouting_events WHERE scouting_id = $1 AND id > $2 ORDER BY id DESC LIMIT $3`, [id, afterId, limit]);
  return rows;
}

export async function upsertResults(scoutingId: string, results: Array<Omit<ScoutingResult, "scouting_id" | "handle" | "display_name" | "avatar_url" | "on_shortlist">>): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM scouting_results WHERE scouting_id = $1 AND preliminary = true`, [scoutingId]);
    for (const r of results) {
      await client.query(
        `INSERT INTO scouting_results (scouting_id, creator_id, rank, fit, fit_parts, tier, verdict, summary, pros, cons, estimated_rate_usd, followers, er, target_audience_pct, platform, city, preliminary, evidence_claim_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (scouting_id, creator_id) DO UPDATE SET rank = EXCLUDED.rank, fit = EXCLUDED.fit, fit_parts = EXCLUDED.fit_parts, tier = EXCLUDED.tier, verdict = EXCLUDED.verdict,
           summary = COALESCE(EXCLUDED.summary, scouting_results.summary), pros = CASE WHEN array_length(EXCLUDED.pros,1) > 0 THEN EXCLUDED.pros ELSE scouting_results.pros END,
           cons = CASE WHEN array_length(EXCLUDED.cons,1) > 0 THEN EXCLUDED.cons ELSE scouting_results.cons END,
           estimated_rate_usd = EXCLUDED.estimated_rate_usd, followers = EXCLUDED.followers, er = EXCLUDED.er, target_audience_pct = EXCLUDED.target_audience_pct,
           platform = EXCLUDED.platform, city = EXCLUDED.city, preliminary = EXCLUDED.preliminary, evidence_claim_ids = EXCLUDED.evidence_claim_ids`,
        [scoutingId, r.creator_id, r.rank, r.fit, JSON.stringify(r.fit_parts), r.tier, r.verdict, r.summary, r.pros, r.cons, r.estimated_rate_usd, r.followers, r.er, r.target_audience_pct, r.platform, r.city, r.preliminary, r.evidence_claim_ids],
      );
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

export async function listResults(scoutingId: string, opts: { platform?: string; sort?: "fit" | "followers" | "engagement"; limit?: number; offset?: number } = {}): Promise<ScoutingResult[]> {
  const order = opts.sort === "followers" ? "r.followers DESC NULLS LAST" : opts.sort === "engagement" ? "r.er DESC NULLS LAST" : "r.rank ASC";
  const { rows } = await db().query(
    `SELECT r.*, c.handle, c.display_name, c.avatar_url, (sl.creator_id IS NOT NULL) AS on_shortlist
     FROM scouting_results r JOIN creators c ON c.id = r.creator_id
     LEFT JOIN shortlist sl ON sl.scouting_id = r.scouting_id AND sl.creator_id = r.creator_id
     WHERE r.scouting_id = $1 AND ($2::text IS NULL OR r.platform = $2)
     ORDER BY ${order} LIMIT $3 OFFSET $4`,
    [scoutingId, opts.platform ?? null, opts.limit ?? 200, opts.offset ?? 0],
  );
  return rows.map((r) => ({ ...r, fit: Number(r.fit), er: r.er == null ? null : Number(r.er), target_audience_pct: r.target_audience_pct == null ? null : Number(r.target_audience_pct), estimated_rate_usd: r.estimated_rate_usd == null ? null : Number(r.estimated_rate_usd) }));
}

export async function toggleShortlist(scoutingId: string, creatorId: string, userId: number | null): Promise<boolean> {
  const { rowCount } = await db().query(`DELETE FROM shortlist WHERE scouting_id = $1 AND creator_id = $2`, [scoutingId, creatorId]);
  if (rowCount) return false;
  await db().query(`INSERT INTO shortlist (scouting_id, creator_id, added_by) VALUES ($1,$2,$3)`, [scoutingId, creatorId, userId]);
  return true;
}

export async function recentContent(creatorId: string, limit = 3): Promise<Array<{ id: string; kind: string; posted_at: Date | null; caption: string | null; media_urls: string[] }>> {
  const { rows } = await db().query(`SELECT id, kind, posted_at, caption, media_urls FROM content_items WHERE creator_id = $1 AND kind <> 'bio' ORDER BY posted_at DESC NULLS LAST LIMIT $2`, [creatorId, limit]);
  return rows;
}
