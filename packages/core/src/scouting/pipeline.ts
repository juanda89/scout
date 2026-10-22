import { config, isLive } from "../config.js";
import { db } from "../db.js";
import { compileBrief } from "../brief/compile.js";
import { validateSpec } from "../brief/validate.js";
import { approveSpec, createBrief, saveSpec } from "../brief/store.js";
import { listPredicates, predicateMap } from "../registry/registry.js";
import { ingestFromApify } from "../ingest/apify.js";
import { storeCreators } from "../ingest/store.js";
import { extractPredicates } from "../extract/run.js";
import { listClaimsForCreators } from "../extract/claims.js";
import { refreshFacets } from "../funnel/facets.js";
import { macroCandidates, type Candidate } from "../funnel/macro-query.js";
import { requiredPredicates } from "../funnel/run.js";
import { enrichAudience } from "../enrich/creatordb.js";
import { evaluateCreator } from "../rules/engine.js";
import { byPriority, vigentes } from "../rules/resolve.js";
import type { BriefSpec } from "../schema/brief.js";
import type { Claim } from "../schema/claim.js";
import { addEvent, getScouting, mergeMetrics, setStage, updateScouting, upsertResults } from "./repo.js";
import { briefTextFrom } from "./fields.js";
import { deriveSeeds } from "./seeds.js";
import { computeFit, estimateRateUsd, FX_TO_USD } from "./fit.js";
import { audienceInAgeRange, audienceInCountries } from "./geo.js";
import { explainResults, type ExplainInput } from "./explain.js";
import { STAGES, tierOf, type Scouting, type ScoutingResult } from "./types.js";

/** Límites de gasto por scouting, ajustables por entorno. */
const LIMITS = {
  ingestPostsPerHashtag: Number(process.env.SCOUT_INGEST_POSTS_PER_HASHTAG ?? 40),
  ingestMaxProfiles: Number(process.env.SCOUT_INGEST_MAX_PROFILES ?? 60),
  audienceMaxCredits: Number(process.env.SCOUT_AUDIENCE_MAX_CREDITS ?? 400),  // 40 perfiles a 10 créditos
  explainTop: Number(process.env.SCOUT_EXPLAIN_TOP ?? 30),
};

export interface PipelineOptions { log?: (s: string) => void; now?: () => Date }

/**
 * Ejecuta las cinco etapas del diseño sobre un scouting. Idempotente respecto a claims y cobertura:
 * repetir un scouting no vuelve a pagar extracciones ya hechas.
 */
export async function runScoutingPipeline(scoutingId: string, opts: PipelineOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  const s0 = await getScouting(scoutingId);
  if (!s0) throw new Error(`scouting ${scoutingId} no existe`);
  if (s0.status === "cancelled") return;
  await updateScouting(scoutingId, { status: "running", started_at: new Date(), error: null });
  let cost = 0;
  const ev = async (stage: number, text: string, kind = "info", data?: unknown) => { log(`[${stage}] ${text}`); await addEvent(scoutingId, stage, text, kind, data); };
  const progress = async (p: number) => updateScouting(scoutingId, { stage_progress: Math.max(0, Math.min(1, p)) });
  const cancelled = async () => (await getScouting(scoutingId))?.status === "cancelled";

  try {
    /* ───────── 01 · Interpreting the brief ───────── */
    await setStage(scoutingId, 1, "running");
    await ev(1, "Reading your description");
    const s = s0;
    const text = briefTextFrom(s.description, s.fields);
    const registry = await listPredicates();
    const compiled = await compileBrief(text, registry, s.name);
    cost += Number(compiled.compiledBy.costUsd ?? 0);
    const spec = applyFieldsToSpec(compiled.spec, s);
    const errors = validateSpec(spec, new Map(registry.map((p) => [p.key, p])));
    if (errors.length) throw new Error(`La especificación compilada no es válida: ${errors.join("; ")}`);
    const briefId = await createBrief(s.name, text);
    const { id: specId } = await saveSpec(briefId, spec, { ...compiled.compiledBy, source: "scouting", scouting_id: scoutingId });
    const registered = await approveSpec(specId, "scouting:confirmed-by-user");
    await updateScouting(scoutingId, { brief_id: briefId, spec_id: specId });
    let criteria = 0;
    for (const [k, f] of Object.entries(spec.macro_filters)) { criteria++; await ev(1, `Criterion: ${describeFilter(k, f)}`); }
    for (const r of spec.requirements) { criteria++; await ev(1, `${r.hard ? "Requirement" : "Preference"}: ${r.rationale ?? `${r.predicate} ${r.rule.op} ${JSON.stringify(r.rule.value ?? "")}`}`); }
    if (registered.length) await ev(1, `New attributes to look for: ${registered.join(", ")}`);
    await mergeMetrics(scoutingId, { criteria });
    await setStage(scoutingId, 1, "done", `${criteria} criteria`);
    if (await cancelled()) return;

    /* ───────── 02 · Finding candidates ───────── */
    await setStage(scoutingId, 2, "running");
    const seeds = await deriveSeeds(s.fields);
    await ev(2, `Search seeds: ${seeds.hashtags.map((h) => "#" + h).join(" ")}`);
    const platforms = s.fields.platforms.length ? s.fields.platforms : ["instagram"];
    let ingested: string[] = [];
    if (process.env.SCOUT_INGEST !== "0" && isLive("apify") && platforms.includes("instagram") && seeds.hashtags.length) {
      try {
        const creators = await ingestFromApify({ hashtags: seeds.hashtags, limit: LIMITS.ingestPostsPerHashtag, maxPostsPerProfile: 12, log: (m) => log("  " + m) });
        const limited = creators.slice(0, LIMITS.ingestMaxProfiles);
        const r = await storeCreators(limited);
        ingested = limited.map((c) => c.handle);
        cost += r.posts * 0.0005;
        await ev(2, `${r.creators} profiles found on Instagram (${r.posts} posts)`);
      } catch (e) {
        await ev(2, `Instagram search failed, continuing with the existing index: ${e instanceof Error ? e.message : e}`, "warn");
      }
    } else {
      await ev(2, isLive("apify") ? "Only the existing creator index is used for the selected platforms" : "Using the existing creator index (Apify not configured)");
    }
    // Clasificación macro (barata) de todo lo que no tenga facetas al día.
    const macro = registry.filter((p) => p.tier === "macro");
    const { rows: pending } = await db().query(
      `SELECT c.id, c.handle FROM creators c LEFT JOIN creator_facets f ON f.creator_id = c.id
       WHERE c.platform = ANY($1) AND (f.creator_id IS NULL OR f.refreshed_at < c.last_crawled OR c.handle = ANY($2))`, [platforms, ingested]);
    let i = 0;
    for (const c of pending) {
      const r = await extractPredicates(c.id, c.handle, macro);
      cost += r.costUsd;
      await refreshFacets(c.id);
      if (r.ran.length) await ev(2, `Classified @${c.handle} (${r.claims} signals)`);
      await progress(++i / Math.max(1, pending.length));
    }
    const { rows: [{ n: found }] } = await db().query(`SELECT count(*)::int AS n FROM creators WHERE platform = ANY($1)`, [platforms]);
    const candidates = await macroCandidates(spec.macro_filters, { platforms });
    await mergeMetrics(scoutingId, { found: Number(found), passed: candidates.length, cost_usd: round(cost) });
    await ev(2, `${candidates.length} of ${found} profiles passed size, location and language filters`);
    await setStage(scoutingId, 2, "done", `${Number(found).toLocaleString("en-US")} profiles found`);
    if (await cancelled()) return;

    /* ───────── 03 · Analyzing content ───────── */
    await setStage(scoutingId, 3, "running");
    const pmap = await predicateMap();
    const needed = requiredPredicates(spec, pmap);
    const toExtract = needed.filter((p) => !["external_api", "none", "metrics"].includes(p.extraction_spec.provider));
    const deep = candidates.slice(0, spec.budget.max_candidates_deep);
    i = 0;
    for (const c of deep) {
      if (cost > spec.budget.max_usd) { await ev(3, `Budget limit reached (${cost.toFixed(2)} USD); remaining profiles are not analyzed`, "warn"); break; }
      const r = await extractPredicates(c.id, c.handle, toExtract);
      cost += r.costUsd;
      if (r.ran.length) await ev(3, `Reviewed recent posts from @${c.handle}: ${r.claims} facts extracted`);
      await progress(++i / Math.max(1, deep.length));
      if (i % 5 === 0) await mergeMetrics(scoutingId, { analyzed: i, cost_usd: round(cost) });
    }
    await mergeMetrics(scoutingId, { analyzed: deep.length, cost_usd: round(cost) });
    // Evaluación preliminar para "Early finds"
    const ctx = { now: new Date(), predicates: pmap, defaultMinConfidence: config.defaultMinConfidence };
    const keys = [...new Set([...needed.map((p) => p.key), "content.category", "brand_safety.flags", "location.city", "audience.locations", "audience.ages"])];
    let claimsBy = await listClaimsForCreators(deep.map((c) => c.id), keys);
    const prelim = deep.map((c) => ({ c, e: evaluateCreator(spec, claimsBy.get(c.id) ?? [], ctx) })).filter((x) => x.e.overall !== "FAIL");
    const dropped = deep.length - prelim.length;
    if (dropped) await ev(3, `Dropped ${dropped} profiles whose content contradicts the brief`, "drop");
    const prelimRows = prelim.map(({ c, e }) => buildResult(scoutingId, c, e, claimsBy.get(c.id) ?? [], spec, s, true)).sort((a, b) => b.fit - a.fit).slice(0, 10).map((r, idx) => ({ ...r, rank: idx + 1 }));
    await upsertResults(scoutingId, prelimRows);
    for (const r of prelimRows.slice(0, 3)) await ev(3, `@${(deep.find((c) => c.id === r.creator_id) ?? { handle: "?" }).handle} added to strong candidates (~${r.fit})`, "find");
    await mergeMetrics(scoutingId, { strong: prelimRows.filter((r) => r.fit >= 80).length });
    await setStage(scoutingId, 3, "done", `${deep.length.toLocaleString("en-US")} profiles analyzed`);
    if (await cancelled()) return;

    /* ───────── 04 · Evaluating audiences ───────── */
    await setStage(scoutingId, 4, "running");
    const needAudience = prelim.map((x) => x.c);
    const maxAud = Math.floor(LIMITS.audienceMaxCredits / 10);
    if (needAudience.length > maxAud) await ev(4, `Checking audiences for the top ${maxAud} of ${needAudience.length} candidates (credit limit)`, "warn");
    i = 0;
    for (const c of needAudience.slice(0, maxAud)) {
      try {
        const r = await enrichAudience(c.id, c.handle);
        cost += r.costUsd;
        if (r.ran && r.data) {
          const loc = audienceInCountries(r.data.locations, s.fields.countries);
          await ev(4, loc == null ? `Audience report for @${c.handle}` : `@${c.handle} — ${loc}% of their audience is in ${s.fields.countries.join("/")}`);
        }
      } catch (e) {
        await ev(4, `Audience data unavailable for @${c.handle}: ${e instanceof Error ? e.message : e}`, "warn");
      }
      await progress(++i / Math.max(1, Math.min(maxAud, needAudience.length)));
    }
    await mergeMetrics(scoutingId, { cost_usd: round(cost) });
    await setStage(scoutingId, 4, "done", `${Math.min(maxAud, needAudience.length)} audiences checked`);
    if (await cancelled()) return;

    /* ───────── 05 · Scoring fit ───────── */
    await setStage(scoutingId, 5, "running");
    claimsBy = await listClaimsForCreators(deep.map((c) => c.id), keys);
    const finals = deep.map((c) => ({ c, e: evaluateCreator(spec, claimsBy.get(c.id) ?? [], ctx) })).filter((x) => x.e.overall !== "FAIL")
      .map(({ c, e }) => buildResult(scoutingId, c, e, claimsBy.get(c.id) ?? [], spec, s, false)).sort((a, b) => b.fit - a.fit).map((r, idx) => ({ ...r, rank: idx + 1 }));
    await progress(0.4);
    const top = finals.slice(0, LIMITS.explainTop);
    const explanations = await explainResults(top.map((r) => explainInput(r, deep.find((c) => c.id === r.creator_id)!, claimsBy.get(r.creator_id) ?? [], s)));
    const byId = new Map(explanations.map((x) => [x.creator_id, x]));
    for (const r of finals) { const x = byId.get(r.creator_id); if (x) { r.summary = x.summary; r.pros = x.pros; r.cons = x.cons; } }
    await progress(0.8);
    await upsertResults(scoutingId, finals);
    const strong = finals.filter((r) => r.fit >= 80).length;
    await ev(5, `Ranked ${finals.length} creators by fit · ${strong} strong candidates`);
    await mergeMetrics(scoutingId, { strong, profiles_analyzed: deep.length, cost_usd: round(cost) });
    await setStage(scoutingId, 5, "done", `${finals.length} creators ranked`);
    await updateScouting(scoutingId, { status: "done", finished_at: new Date(), stage: 5, stage_progress: 1 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cur = (await getScouting(scoutingId))?.stage ?? 0;
    if (cur) await setStage(scoutingId, cur, "failed", msg);
    await addEvent(scoutingId, cur || null, `Scouting failed: ${msg}`, "error");
    await updateScouting(scoutingId, { status: "failed", error: msg, finished_at: new Date() });
    throw e;
  }
}

const round = (n: number) => Number(n.toFixed(4));

/** Los campos confirmados por el usuario mandan sobre lo que el compilador haya deducido. */
export function applyFieldsToSpec(spec: BriefSpec, s: Scouting): BriefSpec {
  const f = s.fields;
  const mf = { ...spec.macro_filters };
  if (f.followers_min != null || f.followers_max != null) mf.followers = { between: [f.followers_min ?? 0, f.followers_max ?? 100_000_000] };
  mf["language.primary"] = { eq: ({ Spanish: "es", English: "en", Portuguese: "pt" } as const)[f.language] };
  const known = ["ES", "MX", "CO", "AR", "CL", "PE", "US", "BR"];
  const countries = f.countries.filter((c) => known.includes(c));
  if (countries.length) mf["location.country"] = { any_of: countries };
  mf["brand_safety.flags"] = { none_of: ["adult", "political_extreme", "hate", "violence"] };
  const wanted = f.creators_wanted ?? 15;
  return { ...spec, macro_filters: mf, budget: { max_candidates_deep: Math.min(300, Math.max(40, wanted * 10)), max_usd: Math.max(spec.budget.max_usd, 60) } };
}

function describeFilter(key: string, f: Record<string, unknown>): string {
  if (f.between) return `${key} between ${(f.between as number[]).map((n) => n.toLocaleString("en-US")).join(" and ")}`;
  if (f.eq !== undefined) return `${key} = ${String(f.eq)}`;
  if (f.any_of) return `${key} in ${(f.any_of as unknown[]).join(", ")}`;
  if (f.none_of) return `exclude ${key}: ${(f.none_of as unknown[]).join(", ")}`;
  return key;
}

function latest(claims: Claim[], key: string): Claim | undefined {
  return vigentes(claims.filter((c) => c.predicate_key === key && c.polarity === "affirms"), { now: new Date(), minConfidence: 0.5 }).sort(byPriority)[0];
}

function buildResult(scoutingId: string, c: Candidate, e: ReturnType<typeof evaluateCreator>, claims: Claim[], spec: BriefSpec, s: Scouting, preliminary: boolean): Omit<ScoutingResult, "handle" | "display_name" | "avatar_url" | "on_shortlist"> {
  const topicCats = new Set<string>((spec.macro_filters["content.category"]?.any_of as string[] | undefined) ?? (spec.macro_filters["content.category"]?.eq ? [spec.macro_filters["content.category"].eq as string] : []));
  const catClaims = claims.filter((x) => x.predicate_key === "content.category" && x.polarity === "affirms");
  const topicShare = catClaims.length && topicCats.size ? catClaims.filter((x) => topicCats.has(String(x.value))).length / catClaims.length : null;
  const locations = (latest(claims, "audience.locations")?.value as Record<string, number> | undefined) ?? null;
  const ages = (latest(claims, "audience.ages")?.value as Record<string, number> | undefined) ?? null;
  const flags = [...new Set(claims.filter((x) => x.predicate_key === "brand_safety.flags").map((x) => String(x.value)))];
  const er = c.er_estimate == null ? null : Number(c.er_estimate);
  const fx = FX_TO_USD[s.fields.currency] ?? 1;
  const budgetPerCreator = s.fields.budget && s.fields.creators_wanted ? (s.fields.budget * fx) / s.fields.creators_wanted : null;
  const audienceLocationPct = audienceInCountries(locations, s.fields.countries);
  const fit = computeFit({
    verdict: e.overall, topicShare, audienceLocationPct, audienceAgePct: audienceInAgeRange(ages, s.fields.age_min, s.fields.age_max),
    followers: c.followers, er, minEngagementPct: s.fields.min_engagement_pct, brandSafetyFlags: flags,
    estimatedRateUsd: estimateRateUsd(c.followers, c.platform), budgetPerCreatorUsd: budgetPerCreator,
  });
  return {
    scouting_id: scoutingId, creator_id: c.id, rank: 0, fit: fit.fit, fit_parts: fit.parts, tier: tierOf(fit.fit), verdict: e.overall === "PASS" ? "PASS" : "UNKNOWN",
    summary: null, pros: [], cons: [], estimated_rate_usd: fit.estimatedRateUsd, followers: c.followers, er, target_audience_pct: audienceLocationPct,
    platform: c.platform, city: (latest(claims, "location.city")?.value as string | undefined) ?? null, preliminary, evidence_claim_ids: e.evidence_claim_ids,
  };
}

function explainInput(r: Omit<ScoutingResult, "handle" | "display_name" | "avatar_url" | "on_shortlist">, c: Candidate, claims: Claim[], s: Scouting): ExplainInput {
  const fx = FX_TO_USD[s.fields.currency] ?? 1;
  return {
    creator_id: r.creator_id, handle: c.handle, platform: c.platform, fit: r.fit, parts: r.fit_parts, followers: r.followers, er: r.er, targetAudiencePct: r.target_audience_pct,
    estimatedRateUsd: r.estimated_rate_usd, budgetPerCreatorUsd: s.fields.budget && s.fields.creators_wanted ? (s.fields.budget * fx) / s.fields.creators_wanted : null,
    verdicts: [], evidence: claims.filter((x) => x.evidence_span && x.evidence_modality !== "external_api").slice(0, 12).map((x) => ({ predicate: x.predicate_key, value: x.value, quote: x.evidence_span, date: x.observed_at?.toISOString().slice(0, 10) ?? null })),
    categories: [...new Set(claims.filter((x) => x.predicate_key === "content.category").map((x) => String(x.value)))],
  };
}

export { STAGES };
