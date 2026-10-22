import { z } from "zod/v4";
import { db } from "../db.js";
import { config, isLive } from "../config.js";
import { llm } from "../llm/client.js";
import { ingestFromApify } from "../ingest/apify.js";
import { storeCreators } from "../ingest/store.js";
import type { IngestedCreator } from "../ingest/types.js";
import { listNiches, searchCreators, submitCreators, type CreatorSearchInput } from "../enrich/creatordb.js";
import { extractPredicates } from "../extract/run.js";
import { listClaimsForCreators } from "../extract/claims.js";
import { listPredicates } from "../registry/registry.js";
import { refreshFacets } from "../funnel/facets.js";
import { macroCandidates } from "../funnel/macro-query.js";
import { requiredPredicates } from "../funnel/run.js";
import { evaluateCreator } from "../rules/engine.js";
import type { BriefSpec } from "../schema/brief.js";
import type { Predicate } from "../schema/predicate.js";
import { A2_TO_A3, normCity, type GeoScope } from "./geo.js";
import { cityFromLocation } from "../ingest/store.js";
import type { ScoutingFields } from "./types.js";

/**
 * Descubrimiento como lo haría una persona con criterio:
 *  - La medida de éxito es cuántas creadoras quedan VERIFICADAS en el tema del brief (requisitos duros
 *    con evidencia), no cuántas pasan filtros de tamaño y ciudad. Cada lote nuevo se verifica en caliente
 *    con Jev (centavos) antes de decidir el siguiente paso.
 *  - Si una fuente rinde, se insiste; si deja de rendir, se abandona. Una página sin verificadas cierra esa consulta.
 *  - Arranque en frío con el índice de CreatorDB cruzando tema Y zona; después bola de nieve desde las
 *    verificadas: las cuentas que Instagram recomienda junto a ellas, los hubs que etiquetan (festivales,
 *    guías, restaurantes) y los hashtags reales que usan. Apify solo para lo que el índice no tiene.
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
export interface StrategyRun { strategy: string; found: number; newProfiles: number; passing: number; verified: number; costUsd: number }
export interface DiscoveryResult { costUsd: number; pool: number; passing: number; verified: number; strategies: StrategyRun[] }

const GENERIC_TAGS = new Set(["food", "foodie", "foodies", "foodporn", "streetfood", "instafood", "yummy", "delicious", "travel", "fitness", "running", "fashion", "beauty", "lifestyle", "love", "instagood", "photooftheday", "reels", "viral", "fyp", "explore", "parati", "comida", "receta", "recetas", "reel", "instagram", "trending", "explorepage", "colombia", "tiktok", "video", "humor", "amor", "familia", "vida"]);
const LANG3: Record<string, string> = { Spanish: "spa", English: "eng", Portuguese: "por" };
/** Tolerancia lógica en el rango de seguidores: "entre 200 y 500 mil" incluye a quien tiene 186 mil. */
export const FOLLOWER_TOLERANCE = 0.1;

export async function runDiscovery(ctx: DiscoveryContext): Promise<DiscoveryResult> {
  const targetVerified = Math.max(6, Math.min(60, ctx.wanted * 3));
  const maxCost = ctx.maxCostUsd ?? Number(process.env.SCOUT_DISCOVERY_MAX_USD ?? 3);
  const registry = await listPredicates();
  const macro = registry.filter((p) => p.tier === "macro");
  const pmap = new Map(registry.map((p) => [p.key, p]));
  const hardSpec: BriefSpec = { ...ctx.spec, requirements: ctx.spec.requirements.filter((r) => r.hard) };
  const hardPreds = requiredPredicates(hardSpec, pmap).filter((p) => p.tier === "micro" && p.extraction_spec.provider === "jev");
  const canVerify = hardSpec.requirements.length > 0 && hardPreds.length > 0;
  const engineCtx = { now: new Date(), predicates: pmap, defaultMinConfidence: config.defaultMinConfidence, jevMinConfidence: config.jevMinConfidence };
  const strategies: StrategyRun[] = [];
  let cost = 0;
  const verified = new Set<string>();      // ids verificados en el tema
  const checked = new Set<string>();       // ids ya verificados (con cualquier resultado)
  const handleOf = new Map<string, string>();
  const geoTerms = [...new Set([...ctx.geo.search_terms, ...ctx.geo.cities.slice(0, 8)].map(normCity).filter(Boolean))];
  const hasGeoTerm = (tag: string) => geoTerms.some((t) => t.length >= 3 && tag.includes(t.replace(/\s+/g, "")));
  const apify = { down: null as string | null };   // si Apify deja de responder (límite mensual, token), no se insiste en esa corrida
  const apifyFailed = async (what: string, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/limit exceeded|hard limit|quota|unauthorized|401|402|403/i.test(msg)) apify.down = msg;
    await ctx.ev(`${what} failed: ${msg.slice(0, 160)}`, "warn");
  };
  const tol = FOLLOWER_TOLERANCE;
  const followersMin = ctx.fields.followers_min ? Math.floor(ctx.fields.followers_min * (1 - tol)) : null;
  const followersMax = ctx.fields.followers_max ? Math.ceil(ctx.fields.followers_max * (1 + tol)) : null;

  const passingIds = async () => (await macroCandidates(ctx.spec.macro_filters, { platforms: ctx.platforms })).map((c) => c.id);
  const poolSize = async () => Number((await db().query(`SELECT count(*)::int AS n FROM creators WHERE platform = ANY($1)`, [ctx.platforms])).rows[0].n);
  const done = () => verified.size >= targetVerified || cost >= maxCost;
  const tally = () => canVerify ? `${verified.size} verified so far` : `${verified.size} matching so far`;

  /** Verifica en caliente los requisitos duros (Jev sobre bio y captions). Devuelve cuántas nuevas verificadas y el costo. */
  const verify = async (ids: string[]): Promise<{ added: number; costUsd: number }> => {
    let added = 0, c = 0;
    const fresh = ids.filter((id) => !checked.has(id));
    if (!fresh.length) return { added, costUsd: c };
    if (!canVerify) { for (const id of fresh) { checked.add(id); verified.add(id); added++; } return { added, costUsd: c }; }
    const { rows } = await db().query(`SELECT id, handle FROM creators WHERE id = ANY($1)`, [fresh]);
    for (const r of rows) handleOf.set(r.id, r.handle);
    for (const id of fresh) {
      checked.add(id);
      try { c += (await extractPredicates(id, handleOf.get(id) ?? "", hardPreds)).costUsd; }
      catch (e) { ctx.log(`verificación fallida @${handleOf.get(id)}: ${e instanceof Error ? e.message.slice(0, 120) : e}`); continue; }
      const claims = (await listClaimsForCreators([id], hardPreds.map((p) => p.key))).get(id) ?? [];
      const e = evaluateCreator(hardSpec, claims, engineCtx);
      if (e.overall === "PASS") { verified.add(id); added++; }
    }
    return { added, costUsd: c };
  };

  /** Guarda, clasifica (barato primero), busca la zona en bio y posts, verifica el tema y mide el rendimiento. */
  const absorb = async (strategy: string, input: unknown, creators: IngestedCreator[], extraCost: number, labelText: string): Promise<StrategyRun> => {
    const before = new Set(await passingIds());
    for (const c of creators) c.discovered_via = strategy;   // la fuente que lo trajo, para medir rendimiento por estrategia
    const stored = await storeCreators(creators);
    const handles = creators.map((c) => c.handle.toLowerCase());
    const { rows: pending } = await db().query(
      `SELECT c.id, c.handle FROM creators c LEFT JOIN creator_facets f ON f.creator_id = c.id
        WHERE c.platform = ANY($1) AND lower(c.handle) = ANY($2) AND (f.creator_id IS NULL OR f.refreshed_at < c.last_crawled)`, [ctx.platforms, handles]);
    if (ctx.geo.cities.length) await cityEvidence(pending.map((c) => c.id), ctx.geo);
    let classifyCost = 0, failures = 0;
    for (const c of pending) {
      try { classifyCost += await classifyCreator(c.id, c.handle, macro, ctx); }
      catch (e) { failures++; ctx.log(`clasificación fallida @${c.handle}: ${e instanceof Error ? e.message.slice(0, 120) : e}`); }
    }
    if (failures) await ctx.ev(`${failures} profiles could not be classified right now (provider errors); they stay in the index for the next run`, "warn");
    const after = await passingIds();
    const newPassing = after.filter((id) => !before.has(id));
    const v = await verify(newPassing);
    const run: StrategyRun = { strategy, found: creators.length, newProfiles: stored.creators, passing: newPassing.length, verified: v.added, costUsd: extraCost + classifyCost + v.costUsd };
    cost += run.costUsd;
    strategies.push(run);
    await db().query(`INSERT INTO discovery_runs (scouting_id, strategy, input, found, new_profiles, passing, verified, cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.scoutingId, strategy, JSON.stringify(input ?? {}), run.found, run.newProfiles, run.passing, run.verified, run.costUsd.toFixed(4)]);
    await ctx.ev(`${labelText}: ${creators.length} profiles, ${run.passing} pass the filters, ${run.verified} ${canVerify ? "verified on the brief" : "new matches"} (${run.costUsd.toFixed(2)} USD) · ${tally()}`, run.verified ? "info" : "warn");
    return run;
  };

  /** Una consulta al índice de CreatorDB, página a página mientras rinda. Trae bio y posts con Apify para poder clasificar. */
  const probe = async (name: string, labelText: string, input: CreatorSearchInput, maxPages: number): Promise<number> => {
    if (done() || !isLive("creatordb")) return 0;
    let offset = 0, gained = 0, prev = -1;
    for (let page = 0; page < maxPages; page++) {
      if (done()) break;
      let r;
      try { r = await searchCreators({ ...input, pageSize: 50, offset }); }
      catch (e) { await ctx.ev(`${labelText} failed: ${e instanceof Error ? e.message : e}`, "warn"); break; }
      ctx.log(`creatordb ${name} p${page + 1}: ${r.hits.length} de ${r.total} (${r.costUsd.toFixed(2)} USD)`);
      const { rows: known } = await db().query(`SELECT lower(handle) AS h FROM creators WHERE platform = 'instagram' AND lower(handle) = ANY($1)`, [r.hits.map((h) => h.handle)]);
      const knownSet = new Set(known.map((k) => String(k.h)));
      const fresh = r.hits.filter((h) => !knownSet.has(h.handle));
      if (!r.hits.length) { cost += r.costUsd; strategies.push({ strategy: name, found: 0, newProfiles: 0, passing: 0, verified: 0, costUsd: r.costUsd }); break; }
      // Perfiles ya conocidos: no se vuelven a traer; solo se verifican si pasan filtros y aún no se habían verificado.
      const { rows: knownIds } = await db().query(`SELECT id FROM creators WHERE platform = 'instagram' AND lower(handle) = ANY($1)`, [[...knownSet]]);
      const passingNow = new Set(await passingIds());
      const reVerify = await verify(knownIds.map((k) => k.id).filter((id) => passingNow.has(id)));
      cost += reVerify.costUsd;
      let run: StrategyRun | null = null;
      if (fresh.length) {
        let ing = { creators: [] as IngestedCreator[], costUsd: 0 };
        if (isLive("apify") && !apify.down) {
          try { ing = await ingestFromApify({ profiles: fresh.map((h) => h.handle).slice(0, 50), maxPostsPerProfile: 12, log: ctx.log }); }
          catch (e) { await apifyFailed("Profile details (Apify)", e); }
        }
        // Sin bio ni posts no hay cómo clasificar: los perfiles quedan en el índice con lo que dio CreatorDB y se completan en la próxima corrida.
        const creators = ing.creators.length ? ing.creators : fresh.map((h) => ({ platform: "instagram" as const, handle: h.handle, display_name: h.displayName, followers: h.followers, avatar_url: h.avatarUrl, posts: [], discovered_via: name }));
        run = await absorb(name, { filters: input, page: page + 1 }, creators, r.costUsd + ing.costUsd, labelText);
        if (apify.down) break;
      } else {
        cost += r.costUsd;
        await ctx.ev(`${labelText}: ${r.hits.length} profiles already in the index, ${reVerify.added} newly verified · ${tally()}`);
      }
      const y = (run?.verified ?? 0) + reVerify.added;
      gained += y;
      // Rendimiento: una página sin verificadas cierra la consulta; si cae a menos de la mitad y es baja, también.
      if (y === 0 || (prev >= 0 && y < 2 && y < prev / 2)) break;
      prev = y;
      if (r.nextOffset == null) break;
      offset = r.nextOffset;
    }
    return gained;
  };

  /* 0 · Lo que ya está en el índice: zona sin costo y verificación de quien ya pasa filtros */
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
  {
    const existing = await passingIds();
    const v = await verify(existing);
    cost += v.costUsd;
    if (existing.length) await ctx.ev(`${existing.length} profiles already in the index pass the filters; ${verified.size} ${canVerify ? "verified on the brief" : "matching"} (${v.costUsd.toFixed(2)} USD)`);
  }

  const base: CreatorSearchInput = { countriesAlpha3: ctx.geo.countries.map((c) => A2_TO_A3[c] ?? c), followersMin, followersMax, language: LANG3[ctx.fields.language] ?? null, activeWithinDays: 90 };
  const geoTags = geoTerms.map((t) => t.replace(/\s+/g, "")).filter((t) => t.length >= 4).slice(0, 20);
  const nicheIds = isLive("creatordb") ? await pickNicheIds(ctx.fields.topics) : [];
  if (nicheIds.length) ctx.log(`nichos de CreatorDB: ${nicheIds.join(", ")}`);

  /* 1 · Arranque en frío: tema Y zona en el índice */
  if (nicheIds.length && geoTags.length) await probe("creatordb:niche+geo", "CreatorDB index (topic niches × local hashtags)", { ...base, nicheIds, hashtags: geoTags }, 3);
  if (ctx.seeds.length) await probe("creatordb:seed-hashtags", "CreatorDB index (topic hashtags)", { ...base, hashtags: ctx.seeds.slice(0, 30) }, 2);

  /* 2 · Bola de nieve desde las verificadas, en rondas mientras aparezcan nuevas */
  const usedSeeds = new Set<string>(), usedHubs = new Set<string>(), usedTags = new Set<string>();
  const primaryCats = ((ctx.spec.macro_filters["content.category"]?.any_of as string[] | undefined) ?? []).slice(0, 1);
  const topicWords = (await nicheWords(ctx.fields.topics)).map((w) => normCity(w).replace(/\s+/g, "")).filter((w) => w.length >= 4);
  const isTopical = (tag: string) => topicWords.some((w) => tag.includes(w));
  for (let round = 1; round <= 4 && !done(); round++) {
    const beforeRound = verified.size;
    try {
    // Semillas: las verificadas; si son pocas, también quienes pasan filtros y publican de la categoría principal
    // (una persona miraría los "similares" de cualquier foodie de la zona, no solo de las ya confirmadas).
    let seedIds = [...verified];
    if (seedIds.length < 6 && primaryCats.length) {
      // Solo entre quienes ya pasan los filtros (zona, tamaño, idioma): foodies de la zona aunque el brief no los verifique.
      const topical = (await macroCandidates(ctx.spec.macro_filters, { platforms: ctx.platforms }))
        .filter((c) => !verified.has(c.id) && ((c.facets["content.category"] as string[] | undefined) ?? []).some((x) => primaryCats.includes(x)))
        .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)).slice(0, 12);
      seedIds = [...seedIds, ...topical.map((c) => c.id)];
    }
    if (!seedIds.length) break;
    const { rows: seedRows } = await db().query(`SELECT id, handle FROM creators WHERE id = ANY($1)`, [seedIds]);
    const seedHandles = seedRows.map((r) => String(r.handle).toLowerCase()).filter((h) => !usedSeeds.has(h));
    seedHandles.forEach((h) => usedSeeds.add(h));
    // a) cuentas que Instagram recomienda junto a las verificadas
    if (seedHandles.length) {
      ctx.log(`related r${round} semillas: ${seedHandles.join(", ")}`);
      await probe(`related:${round}`, `Accounts Instagram recommends next to ${seedHandles.length} verified creators (${seedHandles.slice(0, 3).map((h) => "@" + h).join(", ")}${seedHandles.length > 3 ? "…" : ""})`, { ...base, relatedTo: seedHandles.slice(0, 100) }, 2);
    }
    if (done()) break;
    // b) hubs: cuentas que las verificadas etiquetan (festivales, guías, restaurantes) -> quién más los etiqueta
    const minShared = 2;
    const { rows: hubRows } = await db().query(
      `SELECT lower(m) AS handle, count(DISTINCT ci.creator_id)::int AS n FROM content_items ci JOIN creators c ON c.id = ci.creator_id, unnest(ci.mentions) AS m
        WHERE ci.creator_id = ANY($1) AND lower(m) <> lower(c.handle) GROUP BY lower(m) HAVING count(DISTINCT ci.creator_id) >= $2 OR count(*) >= 3 ORDER BY n DESC LIMIT 40`, [seedIds, minShared]);
    const hubs = hubRows.map((r) => String(r.handle).toLowerCase()).filter((h) => !usedHubs.has(h) && !usedSeeds.has(h)).slice(0, 30);
    hubs.forEach((h) => usedHubs.add(h));
    if (hubs.length) await probe(`tagged:${round}`, `Creators who tag the same places as the verified ones (${hubs.slice(0, 3).map((h) => "@" + h).join(", ")}…)`, { ...base, tagged: hubs }, 2);
    if (done()) break;
    // c) hashtags reales de las verificadas (donde una persona aprende "#medellingourmet")
    const { rows: tagRows } = await db().query(
      `SELECT t AS tag, count(DISTINCT creator_id)::int AS n FROM content_items, unnest(hashtags) AS t WHERE creator_id = ANY($1) GROUP BY t HAVING count(DISTINCT creator_id) >= $2 ORDER BY n DESC, t LIMIT 60`, [seedIds, minShared]);
    const tags = tagRows.map((r) => ({ t: String(r.tag).toLowerCase(), n: Number(r.n) }))
      .filter(({ t, n }) => !GENERIC_TAGS.has(t) && !usedTags.has(t) && t.length >= 5 && !ctx.seeds.includes(t) && (isTopical(t) || (hasGeoTerm(t) && n >= 2) || n >= 4))
      .map(({ t }) => t).slice(0, 25);
    tags.forEach((t) => usedTags.add(t));
    if (tags.length) await probe(`learned-hashtags:${round}`, `Hashtags the verified creators really use (${tags.slice(0, 3).map((t) => "#" + t).join(" ")}…)`, { ...base, hashtags: tags }, 2);
    } catch (e) { await ctx.ev(`Snowball round ${round} failed: ${e instanceof Error ? e.message : e}`, "warn"); }
    if (verified.size === beforeRound) break;   // la ronda no aportó: no insistir
  }

  /* 2b · A quién mencionan los hubs: un festival o una guía gastronómica etiqueta a las creadoras que cubre. Camino para quien no está en el índice. */
  if (!done() && isLive("apify") && !apify.down && usedHubs.size) {
    try {
      const hubs = [...usedHubs].slice(0, 6);
      const hubIng = await ingestFromApify({ profiles: hubs, maxPostsPerProfile: 30, log: ctx.log });
      await storeCreators(hubIng.creators);
      const mentioned = new Map<string, number>();
      for (const h of hubIng.creators) for (const p of h.posts) for (const m of p.mentions ?? []) { const k = m.toLowerCase(); if (k !== h.handle.toLowerCase()) mentioned.set(k, (mentioned.get(k) ?? 0) + 1); }
      const { rows: known } = await db().query(`SELECT lower(handle) AS h FROM creators WHERE platform = 'instagram' AND lower(handle) = ANY($1)`, [[...mentioned.keys()]]);
      const knownSet = new Set(known.map((k) => String(k.h)));
      const handles = [...mentioned.entries()].filter(([h]) => !knownSet.has(h)).sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 40);
      if (handles.length) {
        const ing = await ingestFromApify({ profiles: handles, maxPostsPerProfile: 12, log: ctx.log });
        await absorb("hub-mentions", { hubs, handles }, ing.creators, hubIng.costUsd + ing.costUsd, `Accounts featured by the hubs (${hubs.slice(0, 3).map((h) => "@" + h).join(", ")})`);
      }
    } catch (e) { await apifyFailed("Hub mentions", e); }
  }

  /* 3 · Si sigue corto: nicho por país (más amplio) y hashtags de la zona (lo más amplio) */
  if (!done() && nicheIds.length) await probe("creatordb:niche", "CreatorDB index (topic niches, whole country)", { ...base, nicheIds }, 2);
  if (!done() && geoTags.length) await probe("creatordb:geo-hashtags", "CreatorDB index (local hashtags)", { ...base, hashtags: geoTags }, 2);

  /* 4 · Lo que el índice no tiene: Apify (búsqueda de perfiles por palabra clave y posts de los hashtags aprendidos) */
  if (!done() && isLive("apify") && !apify.down) {
    const queries = buildQueries(ctx.fields.topics, geoTerms);
    if (queries.length) {
      try {
        const ing = await ingestFromApify({ queries, limit: 20, maxPostsPerProfile: 12, log: ctx.log });
        await absorb("profile_search", { queries }, ing.creators, ing.costUsd, "Instagram profile search");
      } catch (e) { await apifyFailed("Profile search", e); }
    }
  }
  if (!done() && isLive("apify") && !apify.down && usedTags.size) {
    // Posts bajo un hashtag traen sobre todo negocios y cuentas pequeñas: solo etiquetas muy específicas (tema Y zona, o el nombre de un hub), pocas y con tope.
    const tags = [...usedTags].filter((t) => (isTopical(t) && hasGeoTerm(t)) || usedHubs.has(t)).slice(0, 4);
    if (tags.length) {
      try {
        const ing = await ingestFromApify({ hashtags: tags, limit: 20, maxPostsPerProfile: 12, log: ctx.log });
        await absorb("hashtag-posts", { tags }, ing.creators, ing.costUsd, `Who posts under ${tags.slice(0, 3).map((t) => "#" + t).join(" ")}`);
      } catch (e) { await apifyFailed("Hashtag search", e); }
    }
  }

  if (apify.down) await ctx.ev(`Apify is unavailable for this run (${apify.down.slice(0, 80)}); profiles found by CreatorDB stay in the index without bio or posts until the next run`, "warn");

  /* 5 · Las verificadas que el índice de CreatorDB no tenía se le envían (gratis): el próximo brief las encontrará por "similares" y hashtags. */
  if (verified.size && isLive("creatordb")) {
    const { rows } = await db().query(`SELECT handle FROM creators WHERE id = ANY($1) AND (discovered_via IS NULL OR discovered_via NOT LIKE 'creatordb%' AND discovered_via NOT LIKE 'related%' AND discovered_via NOT LIKE 'tagged%' AND discovered_via NOT LIKE 'learned%')`, [[...verified]]);
    const n = await submitCreators(rows.map((r) => String(r.handle)));
    if (n) ctx.log(`enviadas a CreatorDB para indexar: ${n}`);
  }

  return { costUsd: cost, pool: await poolSize(), passing: (await passingIds()).length, verified: verified.size, strategies };
}

/**
 * Clasificación macro con control de costo: primero Jev (centavos) sobre bio y captions; la extracción de
 * ciudad con el LLM solo si idioma y país encajan con el brief y las señales determinísticas no la dieron ya.
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

const NicheWords = z.object({ words: z.array(z.string()) });
/**
 * Nichos de CreatorDB para los temas del brief. La lista tiene ~40.000 nombres (son hashtags normalizados),
 * así que el modelo propone palabras de nicho en inglés y español y se cruzan con la lista por nombre exacto.
 */
const nicheWordsCache = new Map<string, string[]>();
/** Palabras de nicho del tema (inglés y español), una sola palabra cada una: "food, foodie, restaurant, comida…". */
export async function nicheWords(topics: string[]): Promise<string[]> {
  const key = topics.join("|");
  const hit = nicheWordsCache.get(key); if (hit) return hit;
  let words: string[] = topics.flatMap((t) => normCity(t).split(" ")).filter((w) => w.length >= 4 && !["tipo", "region", "comercios", "reviews", "hacer", "para", "como"].includes(w));
  const client = llm("classify");
  if (client) {
    try {
      const r = await client.complete({
        system: "Para los temas de un brief de influencers, propone de 6 a 12 palabras de nicho de Instagram, una sola palabra cada una, sin #, en inglés y en español, de lo más general a lo más específico (ej. comida -> food, foodie, foodblogger, restaurant, streetfood, gastronomia, comida, restaurantes). Solo palabras, nada más.",
        user: JSON.stringify({ topics }), schema: NicheWords, schemaName: "niche_words", maxTokens: 400,
      });
      words = [...r.data.words.map((w) => w.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, "")), ...words];
    } catch { /* se queda con las palabras del brief */ }
  }
  words = [...new Set(words.filter(Boolean))];
  nicheWordsCache.set(key, words);
  return words;
}

export async function pickNicheIds(topics: string[]): Promise<string[]> {
  const all = await listNiches();
  if (!all.length || !topics.length) return [];
  const byName = new Map(all.map((n) => [n.name.toLowerCase(), n]));
  const words = await nicheWords(topics);
  const picked: Array<{ id: string; count: number }> = [];
  for (const w of words) { const n = byName.get(w); if (n && !picked.some((p) => p.id === n.id)) picked.push({ id: n.id, count: n.count }); }
  return picked.sort((a, b) => b.count - a.count).slice(0, 6).map((p) => p.id);
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
