import { config, isLive, PRICES } from "../config.js";
import { insertClaims, listClaims } from "../extract/claims.js";
import { isCovered, recordJob } from "../extract/jobs.js";
import { byPriority } from "../rules/resolve.js";

/**
 * Demografía de audiencia vía CreatorDB (pay-as-you-go, 10 créditos por consulta de audiencia).
 * La forma exacta del endpoint y de la respuesta debe verificarse contra la documentación de CreatorDB
 * antes de usar en vivo; aquí se asume GET {base}/instagram/audience?username=... con cabecera de API key.
 */
const BASE = process.env.CREATORDB_BASE_URL ?? "https://api.creatordb.app/v1";
const AUTH_HEADER = process.env.CREATORDB_AUTH_HEADER ?? "x-api-key";

export interface AudienceData { gender_female_pct: number; top_country: string; age_25_34_pct: number; raw?: unknown }

async function fetchLive(handle: string): Promise<AudienceData> {
  const res = await fetch(`${BASE}/instagram/audience?username=${encodeURIComponent(handle)}`, { headers: { [AUTH_HEADER]: config.creatordbKey } });
  if (!res.ok) throw new Error(`CreatorDB ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as Record<string, unknown>;
  // Normalización defensiva: los nombres de campo reales pueden diferir.
  const gender = (j.gender ?? j.audience_gender ?? {}) as Record<string, number>;
  const ages = (j.age ?? j.audience_age ?? {}) as Record<string, number>;
  const countries = (j.countries ?? j.audience_countries ?? {}) as Record<string, number>;
  const top = Object.entries(countries).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  return { gender_female_pct: pct(gender.female ?? gender.f), top_country: top, age_25_34_pct: pct(ages["25-34"]), raw: j };
}

function pct(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? (n <= 1 ? n * 100 : n) : 0; }

function hash(s: string): number { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

async function fetchMock(creatorId: string, handle: string): Promise<AudienceData> {
  const h = hash(handle);
  const countryClaims = (await listClaims(creatorId, ["location.country"])).filter((c) => c.status !== "superseded").sort(byPriority);
  return { gender_female_pct: 50 + (h % 45), top_country: String(countryClaims[0]?.value ?? "ES"), age_25_34_pct: 25 + (h % 30) };
}

export async function enrichAudience(creatorId: string, handle: string): Promise<{ ran: boolean; costUsd: number }> {
  const key = { creatorId, predicateKey: "audience.gender_female_pct", version: 1, scope: "creatordb", provider: "creatordb" };
  if (await isCovered(key)) return { ran: false, costUsd: 0 };
  const live = isLive("creatordb");
  const data = live ? await fetchLive(handle) : await fetchMock(creatorId, handle);
  const now = new Date();
  const base = { creator_id: creatorId, predicate_version: 1, polarity: "affirms" as const, observed_at: now, evidence_content_id: null, evidence_modality: "external_api" as const, confidence: 0.8, extractor: { provider: "creatordb", mode: live ? "live" : "mock" } };
  await insertClaims([
    { ...base, predicate_key: "audience.gender_female_pct", value: data.gender_female_pct, evidence_span: "CreatorDB audience report" },
    { ...base, predicate_key: "audience.top_country", value: data.top_country, evidence_span: "CreatorDB audience report" },
    { ...base, predicate_key: "audience.age_25_34_pct", value: data.age_25_34_pct, evidence_span: "CreatorDB audience report" },
  ]);
  const cost = PRICES.creatordbAudienceUsd;
  await recordJob(key, "done", cost);
  return { ran: true, costUsd: cost };
}
