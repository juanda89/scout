import { db, pool } from "../db.js";
import type { IngestedCreator } from "./types.js";

export interface StoredCreator { id: string; platform: string; handle: string }

/** Persiste creadoras y contenido de forma idempotente. La bio se guarda como content_item kind=bio. */
export async function storeCreators(creators: IngestedCreator[]): Promise<{ creators: number; posts: number }> {
  const client = await pool().connect();
  let nc = 0, np = 0;
  try {
    await client.query("BEGIN");
    for (const c of creators) {
      const { rows } = await client.query(
        `INSERT INTO creators (platform, handle, display_name, discovered_via, last_crawled)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (platform, handle) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, creators.display_name), last_crawled = now()
         RETURNING id`,
        [c.platform, c.handle.toLowerCase(), c.display_name ?? null, c.discovered_via],
      );
      const creatorId = rows[0].id as string;
      nc++;
      if (c.followers != null || c.following != null || c.posts_count != null) {
        const er = estimateEngagement(c);
        await client.query(
          `INSERT INTO creator_metrics_snapshots (creator_id, followers, following, posts, er_estimate, source) VALUES ($1,$2,$3,$4,$5,$6)`,
          [creatorId, c.followers, c.following, c.posts_count, er, c.discovered_via],
        );
      }
      if (c.bio) {
        await client.query(
          `INSERT INTO content_items (creator_id, platform_post_id, kind, posted_at, caption, raw)
           VALUES ($1,'bio','bio',now(),$2,$3)
           ON CONFLICT (creator_id, platform_post_id) DO UPDATE SET caption = EXCLUDED.caption`,
          [creatorId, c.bio, JSON.stringify({ bio: c.bio })],
        );
      }
      for (const p of c.posts) {
        await client.query(
          `INSERT INTO content_items (creator_id, platform_post_id, kind, posted_at, caption, transcript, media_urls, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (creator_id, platform_post_id) DO UPDATE SET caption = EXCLUDED.caption, transcript = COALESCE(EXCLUDED.transcript, content_items.transcript)`,
          [creatorId, p.id, p.kind, p.posted_at, p.caption, p.transcript ?? null, p.media_urls ?? [], JSON.stringify(p.raw ?? p)],
        );
        np++;
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { creators: nc, posts: np };
}

function estimateEngagement(c: IngestedCreator): number | null {
  if (!c.followers) return null;
  const withMetrics = c.posts.filter((p) => p.likes != null);
  if (!withMetrics.length) return null;
  const avg = withMetrics.reduce((a, p) => a + (p.likes ?? 0) + (p.comments ?? 0), 0) / withMetrics.length;
  return Number((avg / c.followers).toFixed(5));
}

export async function findCreatorByHandle(handle: string, platform = "instagram"): Promise<StoredCreator | null> {
  const { rows } = await db().query(`SELECT id, platform, handle FROM creators WHERE platform = $1 AND handle = $2`, [platform, handle.replace(/^@/, "").toLowerCase()]);
  return rows[0] ?? null;
}
