import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "../db.js";

/**
 * Espejo de imágenes en S3. Las URLs de Instagram caducan en horas y bloquean el hotlink, así que la web
 * mostraba imágenes rotas. Fotos de perfil: permanentes (avatars/). Contenido reciente: content/, con regla
 * de ciclo de vida que lo borra a los 7 días. Sin MEDIA_BUCKET no hace nada (las URLs originales se quedan).
 */
const BUCKET = process.env.MEDIA_BUCKET ?? "";
const REGION = process.env.MEDIA_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const PUBLIC_BASE = process.env.MEDIA_PUBLIC_BASE ?? (BUCKET ? `https://${BUCKET}.s3.${REGION}.amazonaws.com` : "");
let client: S3Client | null = null;
const s3 = () => (client ??= new S3Client({ region: REGION }));

export const mediaEnabled = () => Boolean(BUCKET);
export const isMirrored = (url: string | null | undefined) => Boolean(url && PUBLIC_BASE && url.startsWith(PUBLIC_BASE));

/** Descarga una imagen y la sube; devuelve la URL pública o null si no se pudo (la original se conserva). */
export async function mirrorImage(url: string, key: string): Promise<string | null> {
  if (!BUCKET || !url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; ScoutMedia/1.0)" } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (!body.length || body.length > 8 * 1024 * 1024) return null;
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const fullKey = `${key}.${ext}`;
    await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: fullKey, Body: body, ContentType: type, CacheControl: "public, max-age=604800" }));
    return `${PUBLIC_BASE}/${fullKey}`;
  } catch {
    return null;
  }
}

/**
 * Asegura las imágenes de una creadora para mostrarlas: la foto de perfil (siempre) y las primeras `content`
 * publicaciones recientes con imagen. Idempotente: lo que ya está en el bucket no se vuelve a subir.
 */
export async function ensureCreatorMedia(creatorId: string, opts: { content?: number } = {}): Promise<{ avatar: boolean; content: number }> {
  const out = { avatar: false, content: 0 };
  if (!BUCKET) return out;
  const { rows: [c] } = await db().query(`SELECT platform, handle, avatar_url FROM creators WHERE id = $1`, [creatorId]);
  if (!c) return out;
  if (c.avatar_url && !isMirrored(c.avatar_url)) {
    const u = await mirrorImage(c.avatar_url, `avatars/${c.platform}/${c.handle}`);
    if (u) { await db().query(`UPDATE creators SET avatar_url = $2 WHERE id = $1`, [creatorId, u]); out.avatar = true; }
  }
  const n = opts.content ?? 0;
  if (n > 0) {
    const { rows } = await db().query(`SELECT id, media_urls FROM content_items WHERE creator_id = $1 AND kind <> 'bio' AND cardinality(media_urls) > 0 ORDER BY posted_at DESC NULLS LAST LIMIT $2`, [creatorId, n]);
    for (const it of rows) {
      const urls: string[] = it.media_urls ?? [];
      if (!urls.length || isMirrored(urls[0])) continue;
      const u = await mirrorImage(urls[0], `content/${creatorId}/${it.id}`);
      if (u) { await db().query(`UPDATE content_items SET media_urls = $2 WHERE id = $1`, [it.id, [u, ...urls.slice(1)]]); out.content++; }
    }
  }
  return out;
}

/** Espeja en paralelo (con límite) las imágenes de varias creadoras. */
export async function ensureMediaFor(creatorIds: string[], opts: { content?: number; concurrency?: number } = {}): Promise<number> {
  if (!BUCKET || !creatorIds.length) return 0;
  const limit = opts.concurrency ?? 6;
  let i = 0, done = 0;
  const worker = async () => { while (i < creatorIds.length) { const id = creatorIds[i++]; try { await ensureCreatorMedia(id, opts); done++; } catch { /* la original se conserva */ } } };
  await Promise.all(Array.from({ length: Math.min(limit, creatorIds.length) }, worker));
  return done;
}
