import { db } from "../db.js";
import { config } from "../config.js";
import type { BriefSpec } from "../schema/brief.js";
import type { Predicate } from "../schema/predicate.js";
import { predicateMap } from "../registry/registry.js";
import { predicatesProviding } from "../rules/derivations.js";
import { evaluateCreator, type CreatorEvaluation } from "../rules/engine.js";
import { listClaimsForCreators } from "../extract/claims.js";
import { extractPredicates } from "../extract/run.js";
import { enrichAudience } from "../enrich/creatordb.js";
import { macroCandidates, type Candidate } from "./macro-query.js";
import { refreshFacets } from "./facets.js";

export interface RunRow { candidate: Candidate; evaluation: CreatorEvaluation }
export interface RunReport { runId: string; rows: RunRow[]; stageCounts: Record<string, number>; costUsd: number }

/** Predicados que hay que tener extraídos para evaluar la spec (incluye los que proveen derivaciones). */
export function requiredPredicates(spec: BriefSpec, registry: Map<string, Predicate>): Predicate[] {
  const out = new Map<string, Predicate>();
  for (const r of spec.requirements) {
    const p = registry.get(r.predicate);
    if (p) out.set(p.key, p);
    if (r.rule.derived) for (const q of predicatesProviding(r.rule.derived, registry)) out.set(q.key, q);
  }
  return [...out.values()];
}

export async function runBrief(specId: string, spec: BriefSpec, opts: { log?: (s: string) => void } = {}): Promise<RunReport> {
  const log = opts.log ?? (() => {});
  const registry = await predicateMap();
  const needed = requiredPredicates(spec, registry);
  const neededKeys = needed.map((p) => p.key);
  const ctx = { now: new Date(), predicates: registry, defaultMinConfidence: config.defaultMinConfidence };
  const { rows: runRows } = await db().query(`INSERT INTO brief_runs (spec_id) VALUES ($1) RETURNING id`, [specId]);
  const runId = runRows[0].id as string;
  let cost = 0;
  const stageCounts: Record<string, number> = {};

  // [1] Filtro macro: SQL sobre facetas. Costo cero.
  const candidates = await macroCandidates(spec.macro_filters);
  stageCounts.macro_candidates = candidates.length;
  log(`[1] macro: ${candidates.length} candidatas`);

  // [2]+[3] Cobertura y extracción dirigida solo de lo que falta.
  const deep = candidates.slice(0, spec.budget.max_candidates_deep);
  const toExtract = needed.filter((p) => !["external_api", "none", "metrics"].includes(p.extraction_spec.provider));
  let extracted = 0;
  for (const c of deep) {
    if (cost > spec.budget.max_usd) { log(`presupuesto agotado (${cost.toFixed(2)} USD), se detiene la extracción`); break; }
    const s = await extractPredicates(c.id, c.handle, toExtract);
    cost += s.costUsd; extracted += s.claims;
    if (s.ran.length) log(`[3] @${c.handle}: extraídos ${s.ran.join(", ")} -> ${s.claims} claims`);
    else log(`[2] @${c.handle}: cobertura completa, sin extracción`);
  }
  stageCounts.claims_extracted = extracted;

  // [4] Motor de reglas.
  const claimsByCreator = await listClaimsForCreators(deep.map((c) => c.id), neededKeys);
  const rows: RunRow[] = deep.map((candidate) => ({ candidate, evaluation: evaluateCreator(spec, claimsByCreator.get(candidate.id) ?? [], ctx) }));

  // [5] Enriquecimiento externo solo para PASS, y re-evaluación (los blandos pueden usar audiencia).
  const passers = rows.filter((r) => r.evaluation.overall === "PASS");
  const needsAudience = needed.some((p) => p.extraction_spec.provider === "external_api");
  if (needsAudience) {
    for (const r of passers) {
      const e = await enrichAudience(r.candidate.id, r.candidate.handle);
      cost += e.costUsd;
      if (e.ran) log(`[5] @${r.candidate.handle}: audiencia enriquecida (${e.costUsd.toFixed(2)} USD)`);
    }
    const refreshed = await listClaimsForCreators(passers.map((r) => r.candidate.id), neededKeys);
    for (const r of passers) r.evaluation = evaluateCreator(spec, refreshed.get(r.candidate.id) ?? [], ctx);
  }
  for (const c of deep) await refreshFacets(c.id);

  stageCounts.pass = rows.filter((r) => r.evaluation.overall === "PASS").length;
  stageCounts.fail = rows.filter((r) => r.evaluation.overall === "FAIL").length;
  stageCounts.unknown = rows.filter((r) => r.evaluation.overall === "UNKNOWN").length;

  // [6] Persistir resultados.
  for (const r of rows) {
    await db().query(
      `INSERT INTO run_results (run_id, creator_id, verdicts, overall, score, evidence_claim_ids) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (run_id, creator_id) DO UPDATE SET verdicts = EXCLUDED.verdicts, overall = EXCLUDED.overall, score = EXCLUDED.score, evidence_claim_ids = EXCLUDED.evidence_claim_ids`,
      [runId, r.candidate.id, JSON.stringify(Object.fromEntries(r.evaluation.results.map((x) => [x.requirement_id, x]))), r.evaluation.overall, r.evaluation.score, r.evaluation.evidence_claim_ids],
    );
  }
  await db().query(`UPDATE brief_runs SET finished_at = now(), cost_usd = $2, stage_counts = $3 WHERE id = $1`, [runId, cost.toFixed(4), JSON.stringify(stageCounts)]);
  const order = { PASS: 0, UNKNOWN: 1, FAIL: 2 };
  rows.sort((a, b) => order[a.evaluation.overall] - order[b.evaluation.overall] || b.evaluation.score - a.evaluation.score);
  return { runId, rows, stageCounts, costUsd: cost };
}
