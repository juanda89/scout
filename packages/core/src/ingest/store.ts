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
        `INSERT INTO creators (platform, handle, display_name, discovered_via, last_crawled, is_business, business_category, is_verified, avatar_url)
         VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8)
         ON CONFLICT (platform, handle) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, creators.display_name), last_crawled = now(),
           is_business = COALESCE(EXCLUDED.is_business, creators.is_business), business_category = COALESCE(EXCLUDED.business_category, creators.business_category),
           is_verified = COALESCE(EXCLUDED.is_verified, creators.is_verified), avatar_url = COALESCE(EXCLUDED.avatar_url, creators.avatar_url)
         RETURNING id`,
        [c.platform, c.handle.toLowerCase(), c.display_name ?? null, c.discovered_via, c.is_business ?? null, c.business_category ?? null, c.is_verified ?? null, c.avatar_url ?? null],
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
        const { rows: ci } = await client.query(
          `INSERT INTO content_items (creator_id, platform_post_id, kind, posted_at, caption, transcript, media_urls, raw, location_name, hashtags, mentions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (creator_id, platform_post_id) DO UPDATE SET caption = EXCLUDED.caption, transcript = COALESCE(EXCLUDED.transcript, content_items.transcript),
             location_name = COALESCE(EXCLUDED.location_name, content_items.location_name), hashtags = EXCLUDED.hashtags, mentions = EXCLUDED.mentions
           RETURNING id`,
          [creatorId, p.id, p.kind, p.posted_at, p.caption, p.transcript ?? null, p.media_urls ?? [], JSON.stringify(p.raw ?? p), p.location_name ?? null, p.hashtags ?? [], p.mentions ?? []],
        );
        np++;
        // Geotag -> claim de ciudad con evidencia (el post), confianza media: dos posts geotagueados ya son evidencia fuerte.
        const city = cityFromLocation(p.location_name);
        if (city) {
          await client.query(
            `INSERT INTO claims (creator_id, predicate_key, value, polarity, observed_at, evidence_content_id, evidence_span, evidence_modality, confidence, extractor, status)
             SELECT $1,'location.city',$2,'affirms',$3,$4,$5,'metrics',0.7,'{"provider":"geotag"}','auto'
             WHERE NOT EXISTS (SELECT 1 FROM claims WHERE creator_id = $1 AND predicate_key = 'location.city' AND evidence_content_id = $4)`,
            [creatorId, JSON.stringify(city), p.posted_at, ci[0].id, `geotag: ${p.location_name}`],
          );
        }
      }
      // Cuenta de negocio declarada por la plataforma -> claim de tipo de cuenta
      if (c.is_business != null) {
        await client.query(
          `INSERT INTO claims (creator_id, predicate_key, value, polarity, observed_at, evidence_span, evidence_modality, confidence, extractor, status)
           SELECT $1,'account.kind',$2,'affirms',now(),$3,'metrics',0.97,'{"provider":"platform_flag"}','auto'
           WHERE NOT EXISTS (SELECT 1 FROM claims WHERE creator_id = $1 AND predicate_key = 'account.kind' AND evidence_modality = 'metrics')`,
          [creatorId, JSON.stringify(c.is_business ? "business" : "creator"), c.is_business ? `Instagram business account${c.business_category ? ` (${c.business_category})` : ""}` : "Instagram personal/creator account"],
        );
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

/** "Medellín, Antioquia" -> "Medellín". Descarta nombres de locales (con palabras tipo restaurante, café, bar) cuando no hay coma. */
export function cityFromLocation(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const candidate = parts.length >= 2 ? parts[0] : parts[0];
  if (parts.length === 1 && /\b(restaurante|restaurant|caf[eé]|bar|hotel|mall|centro comercial|parque|plaza|club|gym|tienda|store|shop|pizzer|burger|food|cocina|kitchen)\b/i.test(candidate)) return null;
  return candidate.length <= 40 ? candidate : null;
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
