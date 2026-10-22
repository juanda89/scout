import { z } from "zod/v4";
import { db } from "../db.js";
import { config } from "../config.js";
import { llm } from "../llm/client.js";
import { fetchProfilePosts } from "../ingest/apify.js";
import { insertClaims } from "./claims.js";
import { recordJob } from "./jobs.js";
import type { Predicate } from "../schema/predicate.js";
import type { NewClaim } from "../schema/claim.js";
import type { GeoScope } from "../scouting/geo.js";

/**
 * Verificación profunda, como la haría una persona con dudas: abre uno o dos reels (el fijado primero), escucha lo que
 * dicen y lee los comentarios. Gemini recibe el audio del reel y los comentarios (unos 0,002 USD por reel) y responde,
 * con citas, a las preguntas duras del brief, la ciudad y el tipo de cuenta. Solo se usa cuando la bio y los captions
 * no bastaron y hay señales de que el perfil puede aplicar: no es un paso masivo.
 */
const Out = z.object({
  transcript_summary: z.string(),
  claims: z.array(z.object({ predicate_key: z.string(), value_json: z.string(), polarity: z.enum(["affirms", "denies"]), evidence_span: z.string(), confidence: z.number() })),
  city: z.object({ value: z.string().nullable(), evidence: z.string().nullable(), confidence: z.number() }),
  account_kind: z.object({ value: z.enum(["creator", "business", "media", "unknown"]), evidence: z.string().nullable(), confidence: z.number() }),
});

const SYSTEM = `Eres una analista de una agencia de influencers verificando si una cuenta de Instagram encaja con un brief.
Recibes el AUDIO de un reel (lo que dice la creadora o el video), el caption y los comentarios del público.
Reglas:
1. Solo afirmas lo que se oye, se lee en el caption o dicen los comentarios de forma inequívoca. Cita el fragmento literal en evidence_span (en el idioma original). Nada de suposiciones.
2. Para cada predicado del brief emite un claim solo si hay evidencia; value_json debe cumplir su value_schema (booleanos: "true"/"false"; enums: la etiqueta exacta entre comillas).
3. confidence calibrada: 0.95+ literal, 0.75-0.9 inequívoco pero indirecto. Si dudas, no emitas el claim.
4. city: la ciudad o zona donde vive o graba habitualmente si se infiere con claridad (lugares nombrados, acento no cuenta, comentarios que la sitúan sí). Si no, value null.
5. account_kind: creadora (persona que habla en primera persona, reseña o muestra su vida), negocio (vende, local, marca) o medio.
6. transcript_summary: 2 o 3 frases con lo que pasa en el reel.`;

export interface DeepVerifyResult { ran: boolean; claims: number; costUsd: number; city: string | null; summary: string | null }

export async function deepVerify(creatorId: string, handle: string, predicates: Predicate[], opts: { geo?: GeoScope | null; log?: (s: string) => void; maxReels?: number } = {}): Promise<DeepVerifyResult> {
  const log = opts.log ?? (() => {});
  const client = llm("classify");
  if (!client) return { ran: false, claims: 0, costUsd: 0, city: null, summary: null };
  const posts = await fetchProfilePosts([handle], 8, log);
  let cost = posts.costUsd;
  const own = posts.creators.find((c) => c.handle === handle.toLowerCase());
  const videos = (own?.posts ?? [])
    .map((p) => ({ p, raw: (p.raw ?? {}) as Record<string, unknown> }))
    .filter((x) => typeof x.raw.audioUrl === "string" || typeof x.raw.videoUrl === "string")
    .sort((a, b) => Number(Boolean(b.raw.isPinned)) - Number(Boolean(a.raw.isPinned)))   // el fijado primero
    .slice(0, opts.maxReels ?? 2);
  if (!videos.length) return { ran: false, claims: 0, costUsd: cost, city: null, summary: null };
  const preds = predicates.map((p) => ({ key: p.key, label: p.label, value_type: p.value_type, value_schema: p.value_schema, instructions: p.extraction_spec.jev?.instructions ?? p.extraction_spec.claude?.instructions ?? "" }));
  let inserted = 0, city: string | null = null, summary: string | null = null;
  for (const { p, raw } of videos) {
    const audioUrl = (raw.audioUrl ?? raw.videoUrl) as string;
    let data: string;
    try {
      const res = await fetch(audioUrl, { signal: AbortSignal.timeout(20_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !buf.length || buf.length > 12 * 1024 * 1024) { log(`deep @${handle}: audio no disponible (${res.status}, ${(buf.length / 1e6).toFixed(1)} MB)`); continue; }
      data = buf.toString("base64");
    } catch (e) { log(`deep @${handle}: no se pudo bajar el audio: ${e instanceof Error ? e.message : e}`); continue; }
    const comments = (Array.isArray(raw.latestComments) ? (raw.latestComments as Array<Record<string, unknown>>) : []).slice(0, 25).map((c) => `${c.ownerUsername}: ${String(c.text ?? "").replace(/\s+/g, " ")}`).join("\n");
    // El post queda guardado para que el claim tenga evidencia enlazable y la transcripción sirva a la etapa de contenido.
    const { rows: [ci] } = await db().query(
      `INSERT INTO content_items (creator_id, platform_post_id, kind, posted_at, caption, media_urls, raw, location_name, hashtags, mentions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (creator_id, platform_post_id) DO UPDATE SET caption = COALESCE(content_items.caption, EXCLUDED.caption) RETURNING id`,
      [creatorId, p.id, p.kind, p.posted_at, p.caption, p.media_urls ?? [], JSON.stringify({ ...raw, latestComments: undefined }), p.location_name ?? null, p.hashtags ?? [], p.mentions ?? []]);
    const contentId = ci.id as string;
    try {
      const r = await client.complete({
        system: SYSTEM,
        user: `Cuenta: @${handle}\nZona del brief: ${opts.geo?.label ?? "(sin restricción)"}\n\nPREDICADOS DEL BRIEF:\n${JSON.stringify(preds, null, 1)}\n\nCAPTION DEL REEL:\n${p.caption ?? "(sin caption)"}\n\nCOMENTARIOS:\n${comments || "(sin comentarios)"}`,
        schema: Out, schemaName: "deep_verification", maxTokens: 1500, audio: [{ data, format: "mp4" }],
      });
      cost += r.costUsd;
      summary ??= r.data.transcript_summary;
      await db().query(`UPDATE content_items SET transcript = $2 WHERE id = $1`, [contentId, r.data.transcript_summary]);
      const claims: NewClaim[] = [];
      const known = new Set(predicates.map((x) => x.key));
      for (const c of r.data.claims) {
        if (!known.has(c.predicate_key) || c.confidence < 0.6) continue;
        let value: unknown; try { value = JSON.parse(c.value_json); } catch { value = c.value_json; }
        // Un reel que no muestra el tema no es evidencia en contra (ese reel va de otra cosa): ni "false" ni "denies" se guardan.
        // Negar algo exige una declaración explícita ("no tengo hijos"), y eso lo decide la etapa de contenido sobre todos los posts, no un reel suelto.
        if (value === false || c.polarity === "denies") continue;
        claims.push({ creator_id: creatorId, predicate_key: c.predicate_key, predicate_version: predicates.find((x) => x.key === c.predicate_key)?.version ?? 1, value, polarity: c.polarity, observed_at: p.posted_at ? new Date(p.posted_at) : new Date(), evidence_content_id: contentId, evidence_span: `reel: ${c.evidence_span.slice(0, 280)}`, evidence_modality: "transcript", confidence: Math.min(0.97, c.confidence), extractor: { provider: "deep_reel", model: r.model } });
      }
      if (r.data.city.value && r.data.city.confidence >= 0.7) {
        city = r.data.city.value;
        claims.push({ creator_id: creatorId, predicate_key: "location.city", predicate_version: 1, value: r.data.city.value, polarity: "affirms", observed_at: new Date(), evidence_content_id: contentId, evidence_span: `reel: ${(r.data.city.evidence ?? "").slice(0, 200)}`, evidence_modality: "transcript", confidence: Math.min(0.95, r.data.city.confidence), extractor: { provider: "deep_reel", model: r.model } });
      }
      if (r.data.account_kind.value !== "unknown" && r.data.account_kind.confidence >= 0.7) {
        claims.push({ creator_id: creatorId, predicate_key: "account.kind", predicate_version: 1, value: r.data.account_kind.value, polarity: "affirms", observed_at: new Date(), evidence_content_id: contentId, evidence_span: `reel: ${(r.data.account_kind.evidence ?? "").slice(0, 200)}`, evidence_modality: "transcript", confidence: Math.min(0.95, r.data.account_kind.confidence), extractor: { provider: "deep_reel", model: r.model } });
      }
      inserted += await insertClaims(claims);
    } catch (e) {
      log(`deep @${handle}: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  for (const pr of predicates) await recordJob({ creatorId, predicateKey: pr.key, version: pr.version, scope: "deep_reel", provider: "deep_reel" }, "done", cost / Math.max(1, predicates.length)).catch(() => {});
  return { ran: true, claims: inserted, costUsd: cost, city, summary };
}

/** Presupuesto de verificación profunda por corrida (unos 0,02 USD por perfil: reels de Apify + Gemini con audio). */
export const deepBudgetUsd = () => Number(process.env.SCOUT_DEEP_MAX_USD ?? 1.5);
export const deepEnabled = () => Boolean(config.openrouterKey) && process.env.SCOUT_DEEP_VERIFY !== "0";
