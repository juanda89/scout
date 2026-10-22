import "server-only";
import { listScoutings, getScouting, listResults, listEvents, listStages, recentContent, type ScoutingListItem } from "@scout/core/scouting/repo";
import type { Scouting, ScoutingResult, ScoutingEvent } from "@scout/core/scouting/types";
import { db } from "@scout/core/db";
import type { RunningHint } from "@/components/Header";

export type { Scouting, ScoutingResult, ScoutingEvent, ScoutingListItem };

/** Scoutings del usuario. RLS ya filtra por dueño; el parámetro es redundante a propósito. */
export async function scoutingsFor(ownerId: number): Promise<ScoutingListItem[]> { return listScoutings(ownerId); }

export async function runningHint(): Promise<RunningHint | null> {
  const { rows } = await db().query(`SELECT id, stage, stage_progress FROM scoutings WHERE status IN ('running','queued') ORDER BY started_at DESC NULLS LAST LIMIT 1`);
  if (!rows[0]) return null;
  const { rows: [{ n }] } = await db().query(`SELECT count(*)::int AS n FROM scoutings WHERE status IN ('running','queued')`);
  return { id: rows[0].id, count: Number(n), pct: overallPct(Number(rows[0].stage), Number(rows[0].stage_progress)) };
}

export function overallPct(stage: number, progress: number): number {
  if (stage <= 0) return 0;
  return Math.min(100, Math.round(((stage - 1 + Math.min(1, progress)) / 5) * 100));
}

export async function scoutingDetail(id: string) {
  const s = await getScouting(id);
  if (!s) return null;
  const [stages, results, events] = await Promise.all([listStages(id), listResults(id), listEvents(id, 0, 12)]);
  return { s, stages, results, events };
}

export async function creatorContent(creatorId: string) { return recentContent(creatorId, 3); }

export interface ProgressSnapshot {
  status: string; stage: number; progress: number; pct: number; metrics: Scouting["metrics"];
  stages: Array<{ n: number; status: string; detail: string | null; started_at: string | null; finished_at: string | null }>;
  events: Array<{ id: number; stage: number | null; at: string; kind: string; text: string }>;
  finds: Array<{ creator_id: string; handle: string; display_name: string | null; platform: string | null; followers: number | null; fit: number }>;
  started_at: string | null; finished_at: string | null;
}

export async function progressSnapshot(id: string, afterEventId = 0): Promise<ProgressSnapshot | null> {
  const s = await getScouting(id);
  if (!s) return null;
  const [stages, events, finds] = await Promise.all([
    listStages(id), listEvents(id, afterEventId, 30),
    db().query(`SELECT r.creator_id, c.handle, c.display_name, r.platform, r.followers, r.fit FROM scouting_results r JOIN creators c ON c.id = r.creator_id WHERE r.scouting_id = $1 ORDER BY r.fit DESC LIMIT 3`, [id]).then((r) => r.rows),
  ]);
  return {
    status: s.status, stage: s.stage, progress: s.stage_progress, pct: overallPct(s.stage, s.stage_progress), metrics: s.metrics,
    stages: stages.map((x) => ({ ...x, started_at: x.started_at?.toISOString() ?? null, finished_at: x.finished_at?.toISOString() ?? null })),
    events: events.map((e) => ({ id: e.id, stage: e.stage, at: new Date(e.at).toISOString(), kind: e.kind, text: e.text })),
    finds, started_at: s.started_at?.toISOString() ?? null, finished_at: s.finished_at?.toISOString() ?? null,
  };
}
