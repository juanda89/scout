import { config, isLive } from "../config.js";
import { db } from "../db.js";
import { compileBrief } from "../brief/compile.js";
import { validateSpec } from "../brief/validate.js";
import { approveSpec, createBrief, saveSpec } from "../brief/store.js";
import { listPredicates, predicateMap } from "../registry/registry.js";
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
import { computeFit } from "./fit.js";
import { audienceInAgeRange, audienceInCountries, expandLocation, normCity, type GeoScope } from "./geo.js";
import { FOLLOWER_TOLERANCE, runDiscovery } from "./discovery.js";
import { ensureMediaFor, mediaEnabled } from "../media/s3.js";
import { explainResults, type ExplainInput } from "./explain.js";
import { STAGES, tierOf, type Scouting, type ScoutingResult } from "./types.js";

/** Límites de gasto por scouting, ajustables por entorno. */
const LIMITS = {
  ingestPostsPerHashtag: Number(process.env.SCOUT_INGEST_POSTS_PER_HASHTAG ?? 40),
  ingestMaxProfiles: Number(process.env.SCOUT_INGEST_MAX_PROFILES ?? 60),
  audienceMaxUsd: Number(process.env.SCOUT_AUDIENCE_MAX_USD ?? 4),   // informes de audiencia de CreatorDB: 10 créditos (0,40 USD) por perfil
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
    const geo = await expandLocation(s.fields.location, s.fields.countries);
    await ev(1, geo.level === "multi_country" ? `Location: ${geo.label} → ${geo.countries.length} countries` : geo.cities.length ? `Location: ${geo.label} → ${geo.cities.length} cities/municipalities in ${geo.countries.join(", ")}` : `Location: ${geo.label} (${geo.countries.join(", ") || "any country"})`);
    await mergeMetrics(scoutingId, { geo } as Record<string, unknown>);
    const spec = applyFieldsToSpec(compiled.spec, s, geo);
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
    const wanted = s.fields.creators_wanted ?? 15;
    let disc = { costUsd: 0, pool: 0, passing: 0, verified: 0, strategies: [] as Array<{ strategy: string; found: number; newProfiles: number; passing: number; verified: number; costUsd: number }> };
    if (process.env.SCOUT_INGEST !== "0") {
      disc = await runDiscovery({ scoutingId, fields: s.fields, geo, spec, platforms, wanted, seeds: seeds.hashtags, log, ev: (t, k, d) => ev(2, t, k, d) });
      cost += disc.costUsd;
      await progress(1);
    } else {
      await ev(2, "Using the existing creator index (ingestion disabled)");
      // Clasifica lo que no tenga facetas, para que el índice local sirva.
      const macro = registry.filter((p) => p.tier === "macro");
      const { rows: pending } = await db().query(`SELECT c.id, c.handle FROM creators c LEFT JOIN creator_facets f ON f.creator_id = c.id WHERE c.platform = ANY($1) AND (f.creator_id IS NULL OR f.refreshed_at < c.last_crawled)`, [platforms]);
      for (const c of pending) { cost += (await extractPredicates(c.id, c.handle, macro)).costUsd; await refreshFacets(c.id); }
    }
    const { rows: [{ n: found }] } = await db().query(`SELECT count(*)::int AS n FROM creators WHERE platform = ANY($1)`, [platforms]);
    const candidates = await macroCandidates(spec.macro_filters, { platforms });
    await mergeMetrics(scoutingId, { found: Number(found), passed: candidates.length, verified: disc.verified, cost_usd: round(cost) });
    await ev(2, `${candidates.length} of ${found} profiles pass size, location, language and account-type filters${disc.verified ? `; ${disc.verified} already verified on the brief's requirements` : ""}`);
    if (candidates.length < wanted) {
      const diag = await diagnoseFilters(spec, platforms, s, geo);
      await mergeMetrics(scoutingId, { diagnostic: diag } as Record<string, unknown>);
      await ev(2, diag, "warn");
    }
    await setStage(scoutingId, 2, "done", `${Number(found).toLocaleString("en-US")} profiles found`);
    if (await cancelled()) return;

    /* ───────── 03 · Analyzing content ───────── */
    await setStage(scoutingId, 3, "running");
    const pmap = await predicateMap();
    const needed = requiredPredicates(spec, pmap);
    const toExtract = needed.filter((p) => !["external_api", "none", "metrics"].includes(p.extraction_spec.provider));
    const deep = candidates.slice(0, spec.budget.max_candidates_deep);
    let i = 0;
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
    const ctx = { now: new Date(), predicates: pmap, defaultMinConfidence: config.defaultMinConfidence, jevMinConfidence: config.jevMinConfidence };
    const keys = [...new Set([...needed.map((p) => p.key), "content.category", "brand_safety.flags", "location.city", "audience.locations", "audience.ages"])];
    let claimsBy = await listClaimsForCreators(deep.map((c) => c.id), keys);
    const prelim = deep.map((c) => ({ c, e: evaluateCreator(spec, claimsBy.get(c.id) ?? [], ctx) })).filter((x) => x.e.overall !== "FAIL");
    const dropped = deep.length - prelim.length;
    if (dropped) await ev(3, `Dropped ${dropped} profiles whose content contradicts the brief`, "drop");
    const prelimAll = prelim.map(({ c, e }) => buildResult(scoutingId, c, e, claimsBy.get(c.id) ?? [], spec, s, true)).sort(byEvidenceThenFit);
    const prelimRows = prelimAll.slice(0, 10).map((r, idx) => ({ ...r, rank: idx + 1 }));
    await upsertResults(scoutingId, prelimRows);
    if (mediaEnabled()) await ensureMediaFor(prelimRows.map((r) => r.creator_id), { content: 0 });   // fotos de perfil para "Early finds"
    for (const r of prelimRows.slice(0, 3)) await ev(3, `@${(deep.find((c) => c.id === r.creator_id) ?? { handle: "?" }).handle} added to strong candidates (~${r.fit})`, "find");
    await mergeMetrics(scoutingId, { strong: prelimRows.filter((r) => r.fit >= 80).length });
    await setStage(scoutingId, 3, "done", `${deep.length.toLocaleString("en-US")} profiles analyzed`);
    if (await cancelled()) return;

    /* ───────── 04 · Evaluating audiences ───────── */
    await setStage(scoutingId, 4, "running");
    // Los informes de audiencia cuestan 0,40 USD cada uno: solo para las mejores por fit preliminar (el doble de las pedidas, mínimo 6), con tope en dólares.
    const byPrelim = new Map(prelimAll.map((r, idx) => [r.creator_id, idx]));
    const needAudience = prelim.map((x) => x.c).sort((a, b) => (byPrelim.get(a.id) ?? 1e9) - (byPrelim.get(b.id) ?? 1e9));
    const perReport = 10 * Number(process.env.CREATORDB_USD_PER_CREDIT ?? 0.04);
    const maxAud = Math.max(1, Math.min(Math.floor(LIMITS.audienceMaxUsd / perReport), Math.max(6, wanted * 2)));
    if (needAudience.length > maxAud) await ev(4, `Checking audiences for the top ${maxAud} of ${needAudience.length} candidates (${perReport.toFixed(2)} USD per report)`);
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
      .map(({ c, e }) => buildResult(scoutingId, c, e, claimsBy.get(c.id) ?? [], spec, s, false)).sort(byEvidenceThenFit).map((r, idx) => ({ ...r, rank: idx + 1 }));
    await progress(0.4);
    const top = finals.slice(0, LIMITS.explainTop);
    const explanations = await explainResults(top.map((r) => explainInput(r, deep.find((c) => c.id === r.creator_id)!, claimsBy.get(r.creator_id) ?? [])));
    const byId = new Map(explanations.map((x) => [x.creator_id, x]));
    for (const r of finals) { const x = byId.get(r.creator_id); if (x) { r.summary = x.summary; r.pros = x.pros; r.cons = x.cons; } }
    await progress(0.8);
    await upsertResults(scoutingId, finals);
    if (mediaEnabled()) { const n = await ensureMediaFor(finals.map((r) => r.creator_id), { content: 3 }); if (n) await ev(5, `Saved profile photos and recent posts for ${n} creators`); }
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
export function applyFieldsToSpec(spec: BriefSpec, s: Scouting, geo?: GeoScope): BriefSpec {
  const f = s.fields;
  const mf = { ...spec.macro_filters };
  delete mf.er_estimate;                       // el engagement es preferencia blanda, nunca filtro macro
  delete mf["location.city"]; delete mf["location.country"];
  // Seguidores: duro pero lógico. "Entre 200 y 500 mil" incluye a quien tiene 186 mil (10 % de tolerancia).
  if (f.followers_min != null || f.followers_max != null) mf.followers = { between: [Math.floor((f.followers_min ?? 0) * (1 - FOLLOWER_TOLERANCE)), Math.ceil((f.followers_max ?? 100_000_000) * (1 + FOLLOWER_TOLERANCE))] };
  mf["language.primary"] = { eq: ({ Spanish: "es", English: "en", Portuguese: "pt" } as const)[f.language] };
  const known = ["ES", "MX", "CO", "AR", "CL", "PE", "US", "BR"];
  const countries = (geo?.countries.length ? geo.countries : f.countries).filter((c) => known.includes(c));
  if (countries.length) mf["location.country"] = { any_of: countries };
  // Ciudad: filtro duro pero lógico. Solo cuando el brief baja de país; incluye toda la zona (municipios, área metropolitana).
  if (geo && (geo.level === "city" || geo.level === "region") && geo.cities.length) mf["location.city"] = { any_of: [...new Set(geo.cities.map(normCity))].filter(Boolean) };
  mf["account.kind"] = { none_of: ["business", "media"] };
  mf["brand_safety.flags"] = { none_of: ["adult", "political_extreme", "hate", "violence"] };
  const wanted = f.creators_wanted ?? 15;
  return { ...spec, macro_filters: mf, budget: { max_candidates_deep: Math.min(300, Math.max(40, wanted * 10)), max_usd: Math.max(spec.budget.max_usd, 60) } };
}

/** Explica, con números, qué filtro dejó fuera a la mayoría del pool. */
async function diagnoseFilters(spec: BriefSpec, platforms: string[], s: Scouting, geo: GeoScope): Promise<string> {
  const mf = spec.macro_filters;
  const q = async (where: string, params: unknown[] = []) => Number((await db().query(`SELECT count(*)::int AS n FROM creator_facets f JOIN creators c ON c.id = f.creator_id WHERE c.platform = ANY($1) ${where}`, [platforms, ...params])).rows[0].n);
  const total = await q("");
  const parts: string[] = [];
  if (mf.followers?.between) {
    const [lo, hi] = mf.followers.between;
    const inRange = await q("AND f.followers BETWEEN $2 AND $3", [lo, hi]);
    const { rows } = await db().query(`SELECT max(f.followers)::int AS mx FROM creator_facets f JOIN creators c ON c.id = f.creator_id WHERE c.platform = ANY($1)`, [platforms]);
    parts.push(`${inRange} of ${total} have ${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")} followers (largest found: ${Number(rows[0].mx ?? 0).toLocaleString("en-US")})`);
  }
  if (mf["location.country"]?.any_of) parts.push(`${await q("AND f.facets->'location.country' ?| $2::text[]", [mf["location.country"].any_of])} in ${(mf["location.country"].any_of as string[]).join("/")}`);
  if (mf["location.city"]?.any_of) parts.push(`${await q("AND f.facets->'location.city' ?| $2::text[]", [mf["location.city"].any_of])} located in ${geo.label}`);
  if (mf["content.category"]?.any_of) parts.push(`${await q("AND f.facets->'content.category' ?| $2::text[]", [mf["content.category"].any_of])} publish about ${(mf["content.category"].any_of as string[]).join("/")}`);
  parts.push(`${await q("AND NOT COALESCE(f.facets->'account.kind' ?| ARRAY['business','media'], false)")} are not business or media accounts`);
  return `Few matches: ${parts.join("; ")}. Consider widening the follower range or the location.`;
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

/** Primero quien cumple los requisitos duros con evidencia (PASS), luego quien no se pudo verificar (UNKNOWN); dentro de cada grupo, por fit. */
function byEvidenceThenFit(a: { verdict: string; fit: number }, b: { verdict: string; fit: number }): number {
  const g = (v: string) => (v === "PASS" ? 0 : v === "UNKNOWN" ? 1 : 2);
  return g(a.verdict) - g(b.verdict) || b.fit - a.fit;
}

function buildResult(scoutingId: string, c: Candidate, e: ReturnType<typeof evaluateCreator>, claims: Claim[], spec: BriefSpec, s: Scouting, preliminary: boolean): Omit<ScoutingResult, "handle" | "display_name" | "avatar_url" | "on_shortlist"> {
  const topicCats = new Set<string>((spec.macro_filters["content.category"]?.any_of as string[] | undefined) ?? (spec.macro_filters["content.category"]?.eq ? [spec.macro_filters["content.category"].eq as string] : []));
  const catClaims = claims.filter((x) => x.predicate_key === "content.category" && x.polarity === "affirms");
  const topicShare = catClaims.length && topicCats.size ? catClaims.filter((x) => topicCats.has(String(x.value))).length / catClaims.length : null;
  const locations = (latest(claims, "audience.locations")?.value as Record<string, number> | undefined) ?? null;
  const ages = (latest(claims, "audience.ages")?.value as Record<string, number> | undefined) ?? null;
  const flags = [...new Set(claims.filter((x) => x.predicate_key === "brand_safety.flags").map((x) => String(x.value)))];
  const er = c.er_estimate == null ? null : Number(c.er_estimate);
  const audienceLocationPct = audienceInCountries(locations, s.fields.countries);
  const fit = computeFit({
    verdict: e.overall, topicShare, audienceLocationPct, audienceAgePct: audienceInAgeRange(ages, s.fields.age_min, s.fields.age_max),
    followers: c.followers, er, minEngagementPct: s.fields.min_engagement_pct, brandSafetyFlags: flags,
  });
  return {
    scouting_id: scoutingId, creator_id: c.id, rank: 0, fit: fit.fit, fit_parts: fit.parts, tier: tierOf(fit.fit), verdict: e.overall === "PASS" ? "PASS" : "UNKNOWN",
    summary: null, pros: [], cons: [], estimated_rate_usd: null, followers: c.followers, er, target_audience_pct: audienceLocationPct,
    platform: c.platform, city: (latest(claims, "location.city")?.value as string | undefined) ?? null, preliminary, evidence_claim_ids: e.evidence_claim_ids,
  };
}

function explainInput(r: Omit<ScoutingResult, "handle" | "display_name" | "avatar_url" | "on_shortlist">, c: Candidate, claims: Claim[]): ExplainInput {
  return {
    creator_id: r.creator_id, handle: c.handle, platform: c.platform, fit: r.fit, parts: r.fit_parts, followers: r.followers, er: r.er, targetAudiencePct: r.target_audience_pct,
    verdicts: [], evidence: claims.filter((x) => x.evidence_span && x.evidence_modality !== "external_api").slice(0, 12).map((x) => ({ predicate: x.predicate_key, value: x.value, quote: x.evidence_span, date: x.observed_at?.toISOString().slice(0, 10) ?? null })),
    categories: [...new Set(claims.filter((x) => x.predicate_key === "content.category").map((x) => String(x.value)))],
  };
}

export { STAGES };
