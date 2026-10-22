import { z } from "zod/v4";
import { db } from "../db.js";
import { isLive } from "../config.js";
import { llm } from "../llm/client.js";
import { ingestFromApify } from "../ingest/apify.js";
import { storeCreators } from "../ingest/store.js";
import type { IngestedCreator } from "../ingest/types.js";
import { listNiches, searchCreators } from "../enrich/creatordb.js";
import { extractPredicates } from "../extract/run.js";
import { listPredicates } from "../registry/registry.js";
import { refreshFacets } from "../funnel/facets.js";
import { macroCandidates } from "../funnel/macro-query.js";
import type { BriefSpec } from "../schema/brief.js";
import type { Predicate } from "../schema/predicate.js";
import { A2_TO_A3, normCity, type GeoScope } from "./geo.js";
import { cityFromLocation } from "../ingest/store.js";
import type { ScoutingFields } from "./types.js";

/**
 * Descubrimiento por estrategias, como lo haría una persona: prueba una fuente, mide cuántos perfiles
 * útiles aporta, y cambia de estrategia o profundiza (bola de nieve) según el rendimiento.
 * Orden: 1) índice de CreatorDB (arranque en frío, barato), 2) búsqueda de perfiles por palabra clave,
 * 3) bola de nieve desde los candidatos que ya pasan los filtros, 4) hashtags localizados, 5) bola de nieve otra vez.
 */
export interface DiscoveryContext {
  scoutingId: string;
  fields: ScoutingFields;
  geo: GeoScope;
  spec: BriefSpec;
  platforms: string[];
  wanted: number;
  seeds: string[];
  log: (s: string) => void;
  ev: (text: string, kind?: string, data?: unknown) => Promise<void>;
  maxCostUsd?: number;
}
export interface StrategyRun { strategy: string; found: number; newProfiles: number; passing: number; costUsd: number }
export interface DiscoveryResult { costUsd: number; pool: number; passing: number; strategies: StrategyRun[] }

const GENERIC_TAGS = new Set(["food", "foodie", "foodies", "foodporn", "streetfood", "instafood", "yummy", "delicious", "travel", "fitness", "running", "fashion", "beauty", "lifestyle", "love", "instagood", "photooftheday", "reels", "viral", "fyp", "explore", "parati", "comida", "receta", "recetas"]);
const LANG3: Record<string, string> = { Spanish: "spa", English: "eng", Portuguese: "por" };

export async function runDiscovery(ctx: DiscoveryContext): Promise<DiscoveryResult> {
  // Seis candidatas macro por creadora pedida bastan para que las etapas finas elijan (mínimo 15, máximo 120).
  const target = Math.max(15, Math.min(120, ctx.wanted * 6));
  const maxCost = ctx.maxCostUsd ?? Number(process.env.SCOUT_DISCOVERY_MAX_USD ?? 3);
  const macro = (await listPredicates()).filter((p) => p.tier === "macro");
  const strategies: StrategyRun[] = [];
  let cost = 0;
  const geoTerms = [...new Set([...ctx.geo.search_terms, ...ctx.geo.cities.slice(0, 8)].map(normCity).filter(Boolean))];
  const hasGeoTerm = (tag: string) => geoTerms.some((t) => t.length >= 3 && tag.includes(t.replace(/\s+/g, "")));

  const passing = async () => (await macroCandidates(ctx.spec.macro_filters, { platforms: ctx.platforms })).length;

  /* 0 · Lo que ya está en el índice: relee handle, bio, captions y geotags buscando la zona (sin costo). */
  if (ctx.geo.cities.length) {
    const { rows } = await db().query(
      `SELECT c.id FROM creators c LEFT JOIN creator_facets f ON f.creator_id = c.id
        WHERE c.platform = ANY($1) AND (f.creator_id IS NULL OR NOT (f.facets ? 'location.city'))`, [ctx.platforms]);
    const ids = rows.map((r) => r.id as string);
    if (ids.length) {
      const added = await cityEvidence(ids, ctx.geo);
      if (added) {
        const { rows: touched } = await db().query(`SELECT DISTINCT creator_id FROM claims WHERE creator_id = ANY($1) AND predicate_key = 'location.city' AND extractor->>'provider' = 'geo_signal'`, [ids]);
        for (const t of touched) await refreshFacets(t.creator_id);
        ctx.log(`evidencia de ciudad en el índice: ${added} señales en ${touched.length} perfiles`);
      }
    }
  }
  const poolSize = async () => Number((await db().query(`SELECT count(*)::int AS n FROM creators WHERE platform = ANY($1)`, [ctx.platforms])).rows[0].n);

  /** Guarda, clasifica (barato primero) y mide cuántos pasan los filtros macro. */
  const absorb = async (strategy: string, input: unknown, creators: IngestedCreator[], extraCost: number): Promise<StrategyRun> => {
    const before = await passing();
    const stored = await storeCreators(creators);
    const { rows: pending } = await db().query(
      `SELECT c.id, c.handle FROM creators c LEFT JOIN creator_facets f ON f.creator_id = c.id
       WHERE c.platform = ANY($1) AND (f.creator_id IS NULL OR f.refreshed_at < c.last_crawled)`, [ctx.platforms]);
    if (ctx.geo.cities.length) await cityEvidence(pending.map((c) => c.id), ctx.geo);
    let classifyCost = 0, failures = 0;
    for (const c of pending) {
      try { classifyCost += await classifyCreator(c.id, c.handle, macro, ctx); }
      catch (e) { failures++; ctx.log(`clasificación fallida @${c.handle}: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
    }
    if (failures) await ctx.ev(`${failures} profiles could not be classified right now (provider errors); they stay in the index for the next run`, "warn");
    const after = await passing();
    const run: StrategyRun = { strategy, found: creators.length, newProfiles: stored.creators, passing: after - before, costUsd: extraCost + classifyCost };
    cost += run.costUsd;
    strategies.push(run);
    await db().query(`INSERT INTO discovery_runs (scouting_id, strategy, input, found, new_profiles, passing, cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.scoutingId, strategy, JSON.stringify(input), run.found, run.newProfiles, run.passing, run.costUsd.toFixed(4)]);
    await ctx.ev(`${label(strategy)}: ${creators.length} profiles, ${run.passing} new matches (${run.costUsd.toFixed(2)} USD) · ${after} matching so far`);
    return run;
  };
  const enough = async () => (await passing()) >= target;
  const overBudget = () => cost >= maxCost;

  /* 1 · Índice de CreatorDB: país, tamaño, idioma, hashtags y nichos */
  if (isLive("creatordb") && ctx.geo.countries.length) {
    const niches = await pickNiches(ctx.fields.topics, ctx.geo.label);
    const base = { countriesAlpha3: ctx.geo.countries.map((c) => A2_TO_A3[c] ?? c), followersMin: ctx.fields.followers_min, followersMax: ctx.fields.followers_max, language: LANG3[ctx.fields.language] ?? null };
    const geoTags = geoTerms.map((t) => t.replace(/\s+/g, "")).filter((t) => t.length >= 4).slice(0, 20);
    const variants: Array<[string, Parameters<typeof searchCreators>[0], number]> = [];
    if (ctx.seeds.length) variants.push(["hashtags", { ...base, hashtags: ctx.seeds.slice(0, 30) }, 2]);
    if (geoTags.length) variants.push(["geo-hashtags", { ...base, hashtags: geoTags }, 3]);   // quien escribe #medellin en sus captions
    if (niches.length) variants.push(["niches", { ...base, niches }, 2]);
    variants.push(["size+country", base, 4]);
    for (const [vname, input, maxPages] of variants) {
      let offset = 0;
      const bands = vname === "size+country" ? followerBands(input.followersMin, input.followersMax, maxPages) : null;
      let dry = 0;   // páginas seguidas sin candidatas nuevas: una persona cambiaría de estrategia
      for (let page = 0; page < maxPages; page++) {
        if (await enough() || overBudget() || dry >= 2) break;
        try {
          const band = bands?.[page];
          const r = await searchCreators({ ...input, ...(band ? { followersMin: band[0], followersMax: band[1] } : {}), pageSize: 50, offset: band ? 0 : offset });
          ctx.log(`creatordb ${vname} p${page + 1}: ${r.hits.length} de ${r.total} (${r.costUsd.toFixed(2)} USD)`);
          const handles = r.hits.map((h) => h.handle);
          if (!handles.length) { strategies.push({ strategy: `creatordb:${vname}`, found: 0, newProfiles: 0, passing: 0, costUsd: r.costUsd }); cost += r.costUsd; break; }
          const ing = isLive("apify") ? await ingestFromApify({ profiles: handles.slice(0, 50), maxPostsPerProfile: 12, log: ctx.log }) : { creators: [], costUsd: 0, runs: [] };
          const creators = ing.creators.length ? ing.creators : r.hits.map((h) => ({ platform: "instagram" as const, handle: h.handle, display_name: h.displayName, followers: h.followers, avatar_url: h.avatarUrl, posts: [], discovered_via: `creatordb:${vname}` }));
          const run = await absorb(`creatordb:${vname}`, { filters: input, page: page + 1 }, creators, r.costUsd + ing.costUsd);
          dry = run.passing > 0 ? 0 : dry + 1;
          if (band) continue;
          if (r.nextOffset == null) break;
          offset = r.nextOffset;
        } catch (e) { await ctx.ev(`CreatorDB search (${vname}) failed: ${e instanceof Error ? e.message : e}`, "warn"); break; }
      }
    }
  }

  /* 2 · Búsqueda de perfiles por palabra clave en Instagram */
  if (!(await enough()) && !overBudget() && isLive("apify")) {
    const queries = buildQueries(ctx.fields.topics, geoTerms);
    if (queries.length) {
      try {
        const ing = await ingestFromApify({ queries, limit: 20, maxPostsPerProfile: 12, log: ctx.log });
        await absorb("profile_search", { queries }, ing.creators, ing.costUsd);
      } catch (e) { await ctx.ev(`Profile search failed: ${e instanceof Error ? e.message : e}`, "warn"); }
    }
  }

  /* 3 · Bola de nieve desde los que ya encajan */
  if (!(await enough()) && !overBudget() && isLive("apify")) await snowball(ctx, absorb, hasGeoTerm);

  /* 4 · Hashtags localizados */
  if (!(await enough()) && !overBudget() && isLive("apify")) {
    const tags = ctx.seeds.filter((t) => hasGeoTerm(t) || (!GENERIC_TAGS.has(t) && t.length >= 10)).slice(0, 8);
    if (tags.length) {
      try {
        const ing = await ingestFromApify({ hashtags: tags, limit: 40, maxPostsPerProfile: 12, log: ctx.log });
        await absorb("hashtags", { tags }, ing.creators, ing.costUsd);
      } catch (e) { await ctx.ev(`Hashtag search failed: ${e instanceof Error ? e.message : e}`, "warn"); }
    }
  }

  /* 5 · Segunda bola de nieve con lo aprendido */
  if (!(await enough()) && !overBudget() && isLive("apify")) await snowball(ctx, absorb, hasGeoTerm, 2);

  return { costUsd: cost, pool: await poolSize(), passing: await passing(), strategies };
}

function label(s: string): string {
  return s.startsWith("creatordb") ? `CreatorDB index (${s.split(":")[1]})` : s === "profile_search" ? "Instagram profile search" : s.startsWith("snowball") ? "Following the trail of matching creators" : "Localized hashtags";
}

/**
 * Clasificación macro con control de costo: primero Jev (centavos) sobre bio y captions; la extracción de
 * ciudad con el LLM solo si idioma y país encajan con el brief y los geotags no la dieron ya.
 */
async function classifyCreator(creatorId: string, handle: string, macro: Predicate[], ctx: DiscoveryContext): Promise<number> {
  let cost = 0;
  const jev = macro.filter((p) => p.extraction_spec.provider === "jev");
  cost += (await extractPredicates(creatorId, handle, jev)).costUsd;
  let facets = await refreshFacets(creatorId);
  const lang = ({ Spanish: "es", English: "en", Portuguese: "pt" } as Record<string, string>)[ctx.fields.language];
  const langOk = !facets["language.primary"] || facets["language.primary"].includes(lang);
  const country = facets["location.country"]?.[0] as string | undefined;
  const countryOk = !ctx.geo.countries.length || !country || ctx.geo.countries.includes(country);
  const needsCity = ctx.geo.cities.length > 0 && !facets["location.city"];
  if (langOk && countryOk && needsCity) {
    const llmPreds = macro.filter((p) => p.extraction_spec.provider === "claude");
    if (llmPreds.length) { cost += (await extractPredicates(creatorId, handle, llmPreds)).costUsd; facets = await refreshFacets(creatorId); }
  }
  return cost;
}

/** La búsqueda de usuarios de Instagram compara con nombres y handles: consultas cortas (1 o 2 palabras + lugar). */
function buildQueries(topics: string[], geoTerms: string[]): string[] {
  const places = geoTerms.slice(0, 2);
  const shortTopics = [...new Set(topics.map((t) => normCity(t).split(" ").filter((w) => w.length > 2 && !["de", "la", "del", "los", "las", "tipo", "region"].includes(w)).slice(0, 2).join(" ")).filter(Boolean))];
  const out: string[] = [];
  for (const t of shortTopics.slice(0, 3)) for (const p of places) out.push(`${t} ${p}`);
  return [...new Set(out)].slice(0, 6);
}

/** Hashtags reales y cuentas mencionadas por quienes ya encajan: donde una persona aprendería "#medellingourmet". */
async function snowball(ctx: DiscoveryContext, absorb: (s: string, i: unknown, c: IngestedCreator[], extra: number) => Promise<StrategyRun>, hasGeoTerm: (t: string) => boolean, round = 1): Promise<void> {
  const cands = await macroCandidates(ctx.spec.macro_filters, { platforms: ctx.platforms });
  let ids = cands.map((c) => c.id);
  if (!ids.length) {
    // Sin candidatos aún: usa los perfiles del país objetivo con más seguidores como punto de partida.
    const { rows } = await db().query(`SELECT f.creator_id AS id FROM creator_facets f JOIN creators c ON c.id = f.creator_id WHERE c.platform = ANY($1) AND ($2::text[] = '{}' OR f.facets->'location.country' ?| $2) ORDER BY f.followers DESC NULLS LAST LIMIT 15`, [ctx.platforms, ctx.geo.countries]);
    ids = rows.map((r) => r.id);
  }
  if (!ids.length) return;
  const { rows: tagRows } = await db().query(
    `SELECT t AS tag, count(DISTINCT creator_id)::int AS creators FROM content_items, unnest(hashtags) AS t WHERE creator_id = ANY($1) GROUP BY t ORDER BY creators DESC, t LIMIT 60`, [ids]);
  const seedSet = new Set(ctx.seeds);
  const tags = tagRows.map((r) => ({ tag: String(r.tag), n: Number(r.creators) }))
    .filter((r) => !seedSet.has(r.tag) && !GENERIC_TAGS.has(r.tag) && r.tag.length >= 5 && (hasGeoTerm(r.tag) || r.n >= 2))
    .slice(0, 6).map((r) => r.tag);
  const { rows: menRows } = await db().query(
    `SELECT m AS handle, count(DISTINCT creator_id)::int AS creators FROM content_items, unnest(mentions) AS m WHERE creator_id = ANY($1)
       AND m NOT IN (SELECT handle FROM creators) GROUP BY m ORDER BY creators DESC LIMIT 25`, [ids]);
  const handles = menRows.map((r) => String(r.handle));
  if (!tags.length && !handles.length) return;
  try {
    const ing = await ingestFromApify({ hashtags: tags, profiles: handles, limit: 30, maxPostsPerProfile: 12, log: ctx.log });
    await absorb(`snowball:${round}`, { from: ids.length, tags, handles }, ing.creators, ing.costUsd);
  } catch (e) { await ctx.ev(`Snowball search failed: ${e instanceof Error ? e.message : e}`, "warn"); }
}

const NichePick = z.object({ niches: z.array(z.string()) });
/** Elige hasta 5 nichos de CreatorDB afines a los temas del brief (lista cerrada, el modelo solo escoge). */
async function pickNiches(topics: string[], place: string): Promise<string[]> {
  const all = await listNiches();
  const client = llm("classify");
  if (!all.length || !client || !topics.length) return [];
  try {
    const r = await client.complete({ system: "Elige de la lista cerrada los nichos de Instagram que mejor representan los temas del brief. Devuelve entre 1 y 5, copiados exactamente. Si ninguno encaja, lista vacía.", user: JSON.stringify({ topics, place, niches: all.slice(0, 400) }), schema: NichePick, schemaName: "niches", maxTokens: 400 });
    const set = new Set(all);
    return r.data.niches.filter((n) => set.has(n)).slice(0, 5);
  } catch { return []; }
}


/** Divide el rango de seguidores en bandas log-uniformes: cada página del índice muestra otra parte del rango, no solo el tope. */
export function followerBands(min: number | null | undefined, max: number | null | undefined, n: number): Array<[number, number]> {
  const lo = Math.max(1000, min ?? 1000), hi = Math.max(lo * 1.5, max ?? 10_000_000);
  const out: Array<[number, number]> = [];
  for (let i = n - 1; i >= 0; i--) {      // de arriba hacia abajo: primero los más grandes
    const a = Math.round(lo * Math.pow(hi / lo, i / n)), b = Math.round(lo * Math.pow(hi / lo, (i + 1) / n));
    out.push([a, b]);
  }
  return out;
}

/**
 * Evidencia de ciudad sin IA, como la leería una persona: la ciudad en el handle o el nombre, en la bio,
 * en geotags, o repetida en captions/hashtags de varios posts. Una sola mención en un caption no basta.
 * Genera claims con su evidencia; las facetas y el filtro duro de ciudad se calculan después sobre ellas.
 */
export async function cityEvidence(creatorIds: string[], geo: GeoScope): Promise<number> {
  if (!creatorIds.length) return 0;
  const cities = [...new Set(geo.cities.map((c) => c.trim()).filter(Boolean))];
  const norm = (s: string) => normCity(s).replace(/\s+/g, "");
  // término -> ciudad canónica. Los search_terms (gentilicios, abreviaturas: "mde", "medallo", "paisa") apuntan a la ciudad principal.
  const terms = new Map<string, string>();
  for (const c of cities) { const t = norm(c); if (t.length >= 4) terms.set(t, c); }
  // La ciudad principal es la del propio brief (su etiqueta), no la primera de la lista expandida.
  const labelN = norm(geo.label);
  const mainCity = cities.find((c) => labelN.includes(norm(c))) ?? cities[0];
  for (const t of geo.search_terms.map(norm)) if (t.length >= 3 && !terms.has(t) && mainCity) terms.set(t, mainCity);
  if (!terms.size) return 0;
  const tokenRe = (t: string) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  const matchIn = (text: string | null | undefined): [string, string] | null => {
    if (!text) return null;
    const flat = normCity(text);
    const squashed = flat.replace(/[\s._-]+/g, "");
    for (const [t, city] of terms) {
      if (t.length >= 6 ? squashed.includes(t) : tokenRe(t).test(flat) || tokenRe(t).test(squashed)) return [t, city];
    }
    return null;
  };
  const { rows: creators } = await db().query(
    `SELECT c.id, c.handle, c.display_name, (SELECT caption FROM content_items b WHERE b.creator_id = c.id AND b.kind = 'bio' ORDER BY posted_at DESC NULLS LAST LIMIT 1) AS bio
       FROM creators c WHERE c.id = ANY($1) AND NOT EXISTS (SELECT 1 FROM claims k WHERE k.creator_id = c.id AND k.predicate_key = 'location.city' AND k.extractor->>'provider' = 'geo_signal')`, [creatorIds]);
  let n = 0;
  for (const c of creators) {
    const claims: Array<{ value: string; span: string; modality: string; conf: number; contentId?: string }> = [];
    const h = matchIn(`${c.handle} ${c.display_name ?? ""}`);
    if (h) claims.push({ value: h[1], span: `handle/name: ${c.handle}${c.display_name ? ` · ${c.display_name}` : ""}`, modality: "bio", conf: 0.85 });
    const b = matchIn(c.bio);
    if (b) claims.push({ value: b[1], span: `bio: ${String(c.bio).slice(0, 160)}`, modality: "bio", conf: 0.9 });
    const { rows: posts } = await db().query(`SELECT id, caption, hashtags, location_name, posted_at FROM content_items WHERE creator_id = $1 AND kind <> 'bio' ORDER BY posted_at DESC NULLS LAST LIMIT 30`, [c.id]);
    const hits: Array<{ id: string; city: string; span: string; geotag: boolean }> = [];
    for (const p of posts) {
      const g = cityFromLocation(p.location_name); const gm = g ? matchIn(g) : null;
      if (gm) { hits.push({ id: p.id, city: gm[1], span: `geotag: ${p.location_name}`, geotag: true }); continue; }
      const t = matchIn(`${(p.hashtags ?? []).join(" ")} ${p.caption ?? ""}`);
      if (t) hits.push({ id: p.id, city: t[1], span: `caption/hashtag menciona "${t[0]}"`, geotag: false });
    }
    // Dos geotags o cuatro menciones ya son evidencia fuerte; dos o tres menciones en texto, evidencia media.
    const geotags = hits.filter((x) => x.geotag).length;
    if (hits.length >= 2) {
      const conf = geotags >= 2 || hits.length >= 4 ? 0.9 : 0.8;
      for (const x of hits.slice(0, 3)) claims.push({ value: x.city, span: `${x.span} (${hits.length} posts de la zona, ${geotags} con geotag)`, modality: "caption", conf, contentId: x.id });
    }
    for (const k of claims) {
      await db().query(
        `INSERT INTO claims (creator_id, predicate_key, value, polarity, observed_at, evidence_content_id, evidence_span, evidence_modality, confidence, extractor, status)
         VALUES ($1,'location.city',$2,'affirms',now(),$3,$4,$5,$6,'{"provider":"geo_signal"}','auto')`,
        [c.id, JSON.stringify(k.value), k.contentId ?? null, k.span.slice(0, 300), k.modality, k.conf]);
      n++;
    }
  }
  return n;
}
