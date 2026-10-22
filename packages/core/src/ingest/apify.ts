import { ApifyClient } from "apify-client";
import { config, isLive } from "../config.js";
import type { IngestedCreator, IngestedPost } from "./types.js";

/**
 * Ingesta Instagram vía Apify con el actor oficial `apify/instagram-scraper` (pay per event).
 *  - profiles: resultsType=details -> un item por perfil con bio, seguidores y latestPosts.
 *  - hashtags: resultsType=posts -> posts con ownerUsername; luego un pase `details` sobre las
 *    autoras descubiertas para traer bio y seguidores.
 * Los items crudos se guardan en `raw` para no perder campos.
 */
const ACTOR = process.env.APIFY_INSTAGRAM_ACTOR ?? "apify/instagram-scraper";

export interface ApifyIngestOptions {
  hashtags?: string[];
  profiles?: string[];
  /** Búsqueda de perfiles por palabra clave (searchType=user). */
  queries?: string[];
  maxPostsPerProfile?: number;
  /** Máximo de posts por hashtag, de perfiles por búsqueda y de perfiles a detallar. */
  limit?: number;
  log?: (s: string) => void;
}

export interface ApifyIngestResult { creators: IngestedCreator[]; costUsd: number; runs: string[] }

/** Ejecuta el actor y devuelve los items más el costo real de la corrida (usageTotalUsd). */
async function runActor(client: ApifyClient, input: Record<string, unknown>, log: (s: string) => void, label: string): Promise<{ items: Array<Record<string, unknown>>; costUsd: number; runId: string }> {
  const run = await client.actor(ACTOR).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const info = await client.run(run.id).get();
  const costUsd = Number(info?.usageTotalUsd ?? 0);
  log(`apify ${label}: ${items.length} items, ${costUsd.toFixed(3)} USD (run ${run.id})`);
  return { items: items as Array<Record<string, unknown>>, costUsd, runId: run.id };
}

export async function ingestFromApify(opts: ApifyIngestOptions): Promise<ApifyIngestResult> {
  if (!isLive("apify")) throw new Error("APIFY_TOKEN no configurado: usa `scout ingest fixtures` o configura la clave.");
  const client = new ApifyClient({ token: config.apifyToken });
  const log = opts.log ?? (() => {});
  const maxPosts = opts.maxPostsPerProfile ?? 30;
  const limit = opts.limit ?? 100;
  const out = new Map<string, IngestedCreator>();
  let costUsd = 0; const runs: string[] = [];

  const runDetails = async (handles: string[], via: string) => {
    const pending = [...new Set(handles.map((h) => h.replace(/^@/, "").toLowerCase()))].filter((h) => h && !out.get(h)?.bio);
    if (!pending.length) return;
    const r = await runActor(client, { directUrls: pending.map((h) => `https://www.instagram.com/${h}/`), resultsType: "details", resultsLimit: maxPosts }, log, `details(${pending.length})`);
    costUsd += r.costUsd; runs.push(r.runId);
    for (const c of normalizeApifyItems(r.items, via, maxPosts)) out.set(c.handle, { ...c, posts: c.posts.length ? c.posts : (out.get(c.handle)?.posts ?? []) });
  };

  if (opts.profiles?.length) await runDetails(opts.profiles, `apify:${ACTOR}:profiles`);

  if (opts.queries?.length) {
    const found: string[] = [];
    for (const q of opts.queries) {
      const r = await runActor(client, { search: q, searchType: "user", searchLimit: Math.min(limit, 50), resultsType: "details", resultsLimit: maxPosts }, log, `search "${q}"`);
      costUsd += r.costUsd; runs.push(r.runId);
      for (const c of normalizeApifyItems(r.items, `apify:${ACTOR}:search:${q}`, maxPosts)) { if (!out.has(c.handle)) out.set(c.handle, c); found.push(c.handle); }
    }
    await runDetails(found, `apify:${ACTOR}:search`);
  }

  if (opts.hashtags?.length) {
    const r = await runActor(client, { directUrls: opts.hashtags.map((h) => `https://www.instagram.com/explore/tags/${h.replace(/^#/, "")}/`), resultsType: "posts", resultsLimit: limit }, log, `hashtags(${opts.hashtags.length})`);
    costUsd += r.costUsd; runs.push(r.runId);
    const discovered = normalizeApifyItems(r.items, `apify:${ACTOR}:hashtag`, maxPosts);
    for (const c of discovered) if (!out.has(c.handle)) out.set(c.handle, c);
    await runDetails(discovered.map((c) => c.handle).slice(0, limit), `apify:${ACTOR}:hashtag`);
  }
  return { creators: [...out.values()], costUsd, runs };
}

/** Normaliza items de `details` (perfil con latestPosts) y de `posts` (post suelto con ownerUsername). Exportado para tests. */
export function normalizeApifyItems(items: Array<Record<string, unknown>>, discoveredVia: string, maxPosts: number): IngestedCreator[] {
  const byHandle = new Map<string, IngestedCreator>();
  const creatorFor = (handle: string, src: Record<string, unknown>): IngestedCreator => {
    let c = byHandle.get(handle);
    if (!c) {
      c = {
        platform: "instagram",
        handle,
        display_name: str(src.fullName ?? src.ownerFullName ?? src.full_name),
        bio: str(src.biography),
        followers: num(src.followersCount ?? src.follower_count),
        following: num(src.followsCount ?? src.following_count),
        posts_count: num(src.postsCount ?? src.media_count),
        is_business: typeof src.isBusinessAccount === "boolean" ? src.isBusinessAccount : null,
        business_category: str(src.businessCategoryName),
        is_verified: typeof src.verified === "boolean" ? src.verified : typeof src.isVerified === "boolean" ? src.isVerified : null,
        avatar_url: str(src.profilePicUrlHD ?? src.profilePicUrl),
        posts: [],
        discovered_via: discoveredVia,
      };
      byHandle.set(handle, c);
    } else {
      c.bio ??= str(src.biography);
      c.followers ??= num(src.followersCount);
      c.display_name ??= str(src.fullName);
      c.is_business ??= typeof src.isBusinessAccount === "boolean" ? src.isBusinessAccount : null;
      c.business_category ??= str(src.businessCategoryName);
      c.avatar_url ??= str(src.profilePicUrlHD ?? src.profilePicUrl);
    }
    return c;
  };
  for (const it of items) {
    const isProfile = typeof it.username === "string" && (Array.isArray(it.latestPosts) || "biography" in it);
    if (isProfile) {
      const c = creatorFor(String(it.username).toLowerCase(), it);
      for (const p of (it.latestPosts as Array<Record<string, unknown>>) ?? []) addPost(c, p, maxPosts);
      continue;
    }
    const handle = String(it.ownerUsername ?? (it.owner as Record<string, unknown> | undefined)?.username ?? "").toLowerCase();
    if (!handle) continue;
    addPost(creatorFor(handle, { ...(it.owner as Record<string, unknown> ?? {}), ownerFullName: it.ownerFullName }), it, maxPosts);
  }
  return [...byHandle.values()];
}

function addPost(c: IngestedCreator, it: Record<string, unknown>, maxPosts: number): void {
  const id = String(it.shortCode ?? it.shortcode ?? it.id ?? "");
  if (!id || c.posts.length >= maxPosts || c.posts.some((p) => p.id === id)) return;
  const ts = it.timestamp ?? it.taken_at;
  const posted_at = typeof ts === "number" ? new Date(ts * (ts < 1e12 ? 1000 : 1)).toISOString() : typeof ts === "string" ? ts : null;
  const type = String(it.type ?? it.productType ?? "").toLowerCase();
  const post: IngestedPost = {
    id,
    kind: type.includes("video") || type.includes("reel") || it.isVideo === true ? "reel" : "post",
    posted_at,
    caption: typeof it.caption === "object" && it.caption !== null ? str((it.caption as { text?: unknown }).text) : str(it.caption),
    media_urls: [it.displayUrl, it.videoUrl].filter((u): u is string => typeof u === "string"),
    likes: num(it.likesCount ?? it.like_count) ?? undefined,
    comments: num(it.commentsCount ?? it.comment_count) ?? undefined,
    views: num(it.videoViewCount ?? it.videoPlayCount) ?? undefined,
    location_name: str(it.locationName),
    hashtags: Array.isArray(it.hashtags) ? (it.hashtags as unknown[]).map(String).map((h) => h.toLowerCase()) : extractTags(str(it.caption) ?? ""),
    mentions: [...new Set([
      ...(Array.isArray(it.mentions) ? (it.mentions as unknown[]).map(String) : []),
      ...(Array.isArray(it.taggedUsers) ? (it.taggedUsers as Array<Record<string, unknown>>).map((u) => String(u.username ?? "")) : []),
      ...extractMentions(str(it.caption) ?? ""),
    ].map((m) => m.toLowerCase().replace(/^@/, "")).filter(Boolean))],
    raw: it,
  };
  c.posts.push(post);
}

function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
export function extractTags(text: string): string[] { return [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1).toLowerCase()))]; }
export function extractMentions(text: string): string[] { return [...new Set((text.match(/@[\w.]+/g) ?? []).map((t) => t.slice(1).toLowerCase().replace(/\.$/, "")))]; }
function str(v: unknown): string | null { return typeof v === "string" && v.length ? v : null; }
