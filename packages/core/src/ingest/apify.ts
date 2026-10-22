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
  maxPostsPerProfile?: number;
  /** Máximo de posts por hashtag y de perfiles a detallar tras un hashtag. */
  limit?: number;
  log?: (s: string) => void;
}

export async function ingestFromApify(opts: ApifyIngestOptions): Promise<IngestedCreator[]> {
  if (!isLive("apify")) throw new Error("APIFY_TOKEN no configurado: usa `scout ingest fixtures` o configura la clave.");
  const client = new ApifyClient({ token: config.apifyToken });
  const log = opts.log ?? (() => {});
  const maxPosts = opts.maxPostsPerProfile ?? 30;
  const limit = opts.limit ?? 100;
  const out = new Map<string, IngestedCreator>();

  const runDetails = async (handles: string[], via: string) => {
    if (!handles.length) return;
    const run = await client.actor(ACTOR).call({
      directUrls: handles.map((h) => `https://www.instagram.com/${h.replace(/^@/, "")}/`),
      resultsType: "details",
      resultsLimit: maxPosts,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    log(`apify details: ${items.length} perfiles (run ${run.id})`);
    for (const c of normalizeApifyItems(items as Array<Record<string, unknown>>, via, maxPosts)) out.set(c.handle, c);
  };

  if (opts.profiles?.length) await runDetails(opts.profiles, `apify:${ACTOR}:profiles`);

  if (opts.hashtags?.length) {
    const run = await client.actor(ACTOR).call({
      directUrls: opts.hashtags.map((h) => `https://www.instagram.com/explore/tags/${h.replace(/^#/, "")}/`),
      resultsType: "posts",
      resultsLimit: limit,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    log(`apify posts: ${items.length} posts por hashtag (run ${run.id})`);
    const discovered = normalizeApifyItems(items as Array<Record<string, unknown>>, `apify:${ACTOR}:hashtag`, maxPosts);
    for (const c of discovered) if (!out.has(c.handle)) out.set(c.handle, c);
    await runDetails(discovered.map((c) => c.handle).filter((h) => !opts.profiles?.includes(h)).slice(0, limit), `apify:${ACTOR}:hashtag`);
  }
  return [...out.values()];
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
        posts: [],
        discovered_via: discoveredVia,
      };
      byHandle.set(handle, c);
    } else {
      c.bio ??= str(src.biography);
      c.followers ??= num(src.followersCount);
      c.display_name ??= str(src.fullName);
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
    raw: it,
  };
  c.posts.push(post);
}

function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function str(v: unknown): string | null { return typeof v === "string" && v.length ? v : null; }
