import { FIT_WEIGHTS, tierOf, type FitParts, type Tier } from "./types.js";
import type { Verdict } from "../rules/engine.js";

export interface FitInput {
  /** Veredicto del motor sobre los requisitos duros del brief. */
  verdict: Verdict;
  /** Proporción 0..1 de posts clasificados en alguno de los temas del brief. */
  topicShare: number | null;
  /** Porcentaje 0..100 de audiencia en los países objetivo; null si no hay dato. */
  audienceLocationPct: number | null;
  /** Porcentaje 0..100 de audiencia en el rango de edad objetivo; null si no hay dato. */
  audienceAgePct: number | null;
  followers: number | null;
  /** Engagement rate como fracción (0.045 = 4,5 %). */
  er: number | null;
  minEngagementPct: number | null;
  brandSafetyFlags: string[];
}

export interface FitOutput { fit: number; parts: FitParts; tier: Tier }

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Benchmark de engagement por tamaño (fracción). Referencias habituales de la industria, ajustables. */
export function erBenchmark(followers: number | null): number {
  if (!followers) return 0.03;
  if (followers < 10_000) return 0.05;
  if (followers < 100_000) return 0.03;
  if (followers < 500_000) return 0.02;
  return 0.015;
}



export function computeFit(i: FitInput): FitOutput {
  // Topic: el veredicto duro pesa 60 %, la proporción de contenido en tema 40 %.
  const hard = i.verdict === "PASS" ? 100 : i.verdict === "UNKNOWN" ? 50 : 0;
  const share = i.topicShare == null ? 50 : i.topicShare * 100;
  const topic = clamp(0.6 * hard + 0.4 * share);

  // Audience: media de ubicación y edad cuando existen; sin dato = 50 (incierto), nunca 0.
  const audParts = [i.audienceLocationPct, i.audienceAgePct].filter((x): x is number => x != null);
  const audience = audParts.length ? clamp(audParts.reduce((a, b) => a + b, 0) / audParts.length) : 50;

  // Engagement: relativo al benchmark de su tamaño; por debajo del mínimo del brief se penaliza fuerte.
  let engagement = 50;
  if (i.er != null) {
    engagement = clamp((i.er / erBenchmark(i.followers)) * 80);
    if (i.minEngagementPct != null && i.er * 100 < i.minEngagementPct) engagement = Math.min(engagement, 35);
  }

  // Brand safety: cualquier flag grave anula; flags leves descuentan.
  const severe = ["adult", "hate", "violence", "political_extreme"];
  const flags = i.brandSafetyFlags.filter((f) => f !== "none");
  const brand_safety = flags.some((f) => severe.includes(f)) ? 0 : flags.length ? 60 : 100;

  // El presupuesto no entra en el puntaje: la tarifa real se negocia con cada creadora y no se estima por seguidores.
  const parts: FitParts = { topic: Math.round(topic), audience: Math.round(audience), engagement: Math.round(engagement), brand_safety };
  const fit = Math.round((Object.keys(FIT_WEIGHTS) as Array<keyof FitParts>).reduce((a, k) => a + parts[k] * FIT_WEIGHTS[k], 0));
  return { fit: clamp(fit), parts, tier: tierOf(fit) };
}
