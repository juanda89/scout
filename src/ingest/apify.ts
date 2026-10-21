import { ApifyClient } from "apify-client";
import { config, isLive } from "../config.js";
import type { IngestedCreator, IngestedPost } from "./types.js";

/**
 * Ingesta Instagram vía Apify. Actor por defecto: apidojo/instagram-scraper (pay per result).
 * La forma exacta de los items varía entre actores; normalizamos de forma defensiva y
 * guardamos el item crudo en `raw` para no perder nada.
 */
const DEFAULT_ACTOR = process.env.APIFY_INSTAGRAM_ACTOR ?? "apidojo/instagram-scraper";

export interface ApifyIngestOptions {
  hashtags?: string[];
  profiles?: string[];
  maxPostsPerProfile?: number;
  limit?: number;
}

export async function ingestFromApify(opts: ApifyIngestOptions): Promise<IngestedCreator[]> {
  if (!isLive("apify")) throw new Error("APIFY_TOKEN no configurado: usa `scout ingest fixtures` o configura la clave.");
  const client = new ApifyClient({ token: config.apifyToken });
  const input: Record<string, unknown> = {
    maxItems: opts.limit ?? 200,
  };
  if (opts.profiles?.length) input.startUrls = opts.profiles.map((h) => ({ url: `https://www.instagram.com/${h.replace(/^@/, "")}/` }));
  if (opts.hashtags?.length) input.startUrls = [
    ...((input.startUrls as unknown[]) ?? []),
    ...opts.hashtags.map((h) => ({ url: `https://www.instagram.com/explore/tags/${h.replace(/^#/, "")}/` })),
  ];
  const run = await client.actor(DEFAULT_ACTOR).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return normalizeApifyItems(items as Array<Record<string, unknown>>, `apify:${DEFAULT_ACTOR}`, opts.maxPostsPerProfile ?? 50);
}

/** Agrupa items de posts por autor y arma una IngestedCreator por autor. Exportado para tests. */
export function normalizeApifyItems(items: Array<Record<string, unknown>>, discoveredVia: string, maxPosts: number): IngestedCreator[] {
  const byHandle = new Map<string, IngestedCreator>();
  for (const it of items) {
    const owner = (it.owner ?? it.user ?? {}) as Record<string, unknown>;
    const handle = String(it.ownerUsername ?? owner.username ?? it.username ?? "").toLowerCase();
    if (!handle) continue;
    let c = byHandle.get(handle);
    if (!c) {
      c = {
        platform: "instagram",
        handle,
        display_name: (it.ownerFullName ?? owner.full_name ?? owner.fullName ?? null) as string | null,
        bio: (owner.biography ?? it.biography ?? null) as string | null,
        followers: num(owner.followersCount ?? owner.follower_count ?? it.followersCount),
        following: num(owner.followsCount ?? owner.following_count ?? it.followsCount),
        posts_count: num(owner.postsCount ?? owner.media_count ?? it.postsCount),
        posts: [],
        discovered_via: discoveredVia,
      };
      byHandle.set(handle, c);
    }
    const id = String(it.id ?? it.shortCode ?? it.shortcode ?? it.code ?? "");
    if (!id || c.posts.length >= maxPosts) continue;
    const ts = it.timestamp ?? it.taken_at ?? it.takenAt;
    const posted_at = typeof ts === "number" ? new Date(ts * (ts < 1e12 ? 1000 : 1)).toISOString() : typeof ts === "string" ? ts : null;
    const post: IngestedPost = {
      id,
      kind: String(it.type ?? it.productType ?? "").toLowerCase().includes("video") || it.isVideo === true || it.is_video === true ? "reel" : "post",
      posted_at,
      caption: (it.caption ?? (it.caption as Record<string, unknown> | undefined)?.text ?? null) as string | null,
      media_urls: [it.displayUrl, it.videoUrl, it.display_url].filter((u): u is string => typeof u === "string"),
      likes: num(it.likesCount ?? it.like_count) ?? undefined,
      comments: num(it.commentsCount ?? it.comment_count) ?? undefined,
      views: num(it.videoViewCount ?? it.play_count) ?? undefined,
      raw: it,
    };
    if (typeof post.caption === "object" && post.caption !== null) post.caption = String((post.caption as { text?: string }).text ?? "");
    c.posts.push(post);
  }
  return [...byHandle.values()];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
