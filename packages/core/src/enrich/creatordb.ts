import { config, isLive } from "../config.js";
import { insertClaims, listClaims } from "../extract/claims.js";
import { isCovered, recordJob } from "../extract/jobs.js";
import { byPriority } from "../rules/resolve.js";

/**
 * Demografía de audiencia vía CreatorDB API v3 (docs.creatordb.app).
 *  POST https://apiv3.creatordb.app/instagram/audience  { uniqueId }  cabecera api-key
 *  Respuesta: data.audienceGender.{maleRatio,femaleRatio}, data.audienceLocations[{country alpha-3, share}],
 *             data.audienceAgeBreakdown[{ageRange, share}], data.audienceAvgAge; creditsUsed (10 el paquete completo).
 *  Un perfil desconocido devuelve data con nulls y 0 créditos.
 */
const BASE = process.env.CREATORDB_BASE_URL ?? "https://apiv3.creatordb.app";
const USD_PER_CREDIT = Number(process.env.CREATORDB_USD_PER_CREDIT ?? 0.04); // pay-as-you-go; 0.025 en Pro, 0.01 en Enterprise

export interface AudienceData {
  gender_female_pct: number | null;
  top_country: string | null;
  age_25_34_pct: number | null;
  avg_age: number | null;
  /** País alpha-3 -> porcentaje 0..100 */
  locations: Record<string, number>;
  /** Rango de edad ("18-24") -> porcentaje 0..100 */
  ages: Record<string, number>;
  creditsUsed: number;
  raw?: unknown;
}

interface CdbAudienceResponse {
  success: boolean;
  errorCode?: string;
  errorDescription?: string;
  creditsUsed?: number;
  creditsAvailable?: number;
  data?: {
    audienceLocations?: Array<{ country: string; share: number }> | null;
    audienceGender?: { maleRatio: number; femaleRatio: number } | null;
    audienceAvgAge?: number | null;
    audienceAgeBreakdown?: Array<{ ageRange: string; share: number }> | null;
  };
}

export class CreatorDbNotFound extends Error { constructor(handle: string) { super(`CreatorDB no conoce el perfil ${handle}`); } }

async function cdb<T>(path: string, init: RequestInit & { handle?: string }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "api-key": config.creatordbKey, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error(`CreatorDB ${res.status}: ${text.slice(0, 300)}`); }
  if (res.status === 404) throw new CreatorDbNotFound(init.handle ?? path);
  if (!res.ok) throw new Error(`CreatorDB ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j as T;
}

export async function creatordbUsage(): Promise<{ creditsAvailable: number; planCreditsAvailable: number; purchasedCreditsAvailable: number }> {
  return cdb(`/usage`, { method: "GET" });
}

export async function fetchAudienceLive(handle: string): Promise<AudienceData> {
  const j = await cdb<CdbAudienceResponse>(`/instagram/audience`, { method: "POST", body: JSON.stringify({ uniqueId: handle.replace(/^@/, "") }), handle });
  if (!j.success) throw new Error(`CreatorDB ${j.errorCode}: ${j.errorDescription}`);
  const d = j.data ?? {};
  const pct = (x: number | null | undefined) => (typeof x === "number" ? Number((x * 100).toFixed(2)) : null);
  return {
    gender_female_pct: pct(d.audienceGender?.femaleRatio),
    top_country: d.audienceLocations?.[0]?.country ?? null,
    age_25_34_pct: pct(d.audienceAgeBreakdown?.find((a) => a.ageRange === "25-34")?.share),
    avg_age: d.audienceAvgAge ?? null,
    locations: Object.fromEntries((d.audienceLocations ?? []).map((l) => [l.country, pct(l.share) ?? 0])),
    ages: Object.fromEntries((d.audienceAgeBreakdown ?? []).map((a) => [a.ageRange, pct(a.share) ?? 0])),
    creditsUsed: j.creditsUsed ?? 0,
    raw: j,
  };
}

function hash(s: string): number { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

async function fetchAudienceMock(creatorId: string, handle: string): Promise<AudienceData> {
  const h = hash(handle);
  const countryClaims = (await listClaims(creatorId, ["location.country"])).filter((c) => c.status !== "superseded").sort(byPriority);
  const top = ({ ES: "ESP", MX: "MEX", CO: "COL", AR: "ARG", CL: "CHL", PE: "PER", US: "USA", BR: "BRA" } as Record<string, string>)[String(countryClaims[0]?.value ?? "ES")] ?? "ESP";
  const a2534 = 25 + (h % 30);
  return { gender_female_pct: 50 + (h % 45), top_country: top, age_25_34_pct: a2534, avg_age: 30, creditsUsed: 10,
    locations: { [top]: 55 + (h % 30), USA: 10, OTHER: 100 - (55 + (h % 30)) - 10 },
    ages: { "13-17": 3, "18-24": 30 + (h % 15), "25-34": a2534, "35-44": 15, "45-54": 6, "55-64": 3, "65+": 1 } };
}

export async function enrichAudience(creatorId: string, handle: string, opts: { force?: boolean } = {}): Promise<{ ran: boolean; costUsd: number; data?: AudienceData }> {
  const key = { creatorId, predicateKey: "audience.gender_female_pct", version: 1, scope: "creatordb", provider: "creatordb" };
  if (!opts.force && await isCovered(key)) return { ran: false, costUsd: 0 };
  const live = isLive("creatordb");
  let data: AudienceData;
  try {
    data = live ? await fetchAudienceLive(handle) : await fetchAudienceMock(creatorId, handle);
  } catch (e) {
    if (e instanceof CreatorDbNotFound) {
      // Perfil desconocido para CreatorDB: se registra como cubierto (0 créditos) para no volver a preguntar.
      await recordJob(key, "done", 0, e.message);
      return { ran: false, costUsd: 0 };
    }
    throw e;
  }
  const now = new Date();
  const base = { creator_id: creatorId, predicate_version: 1, polarity: "affirms" as const, observed_at: now, evidence_content_id: null, evidence_modality: "external_api" as const, confidence: 0.9, extractor: { provider: "creatordb", mode: live ? "live" : "mock" }, evidence_span: "CreatorDB audience report" };
  const claims = [];
  if (data.gender_female_pct != null) claims.push({ ...base, predicate_key: "audience.gender_female_pct", value: data.gender_female_pct });
  if (data.top_country) claims.push({ ...base, predicate_key: "audience.top_country", value: data.top_country });
  if (data.age_25_34_pct != null) claims.push({ ...base, predicate_key: "audience.age_25_34_pct", value: data.age_25_34_pct });
  if (Object.keys(data.locations).length) claims.push({ ...base, predicate_key: "audience.locations", value: data.locations });
  if (Object.keys(data.ages).length) claims.push({ ...base, predicate_key: "audience.ages", value: data.ages });
  await insertClaims(claims);
  const cost = live ? data.creditsUsed * USD_PER_CREDIT : 10 * USD_PER_CREDIT;
  await recordJob(key, "done", cost);
  return { ran: true, costUsd: cost, data };
}
