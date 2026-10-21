import type { Claim } from "../schema/claim.js";

export const VIGENT_STATUSES = new Set(["auto", "human_confirmed"]);

export interface VigencyOptions {
  now: Date;
  minConfidence: number;
  maxEvidenceAgeDays?: number;
}

/** Claims que cuentan como evidencia: estado vigente, confianza suficiente, evidencia fresca. */
export function vigentes(claims: Claim[], opts: VigencyOptions): Claim[] {
  return claims.filter((c) => {
    if (!VIGENT_STATUSES.has(c.status)) return false;
    const isHuman = c.evidence_modality === "human" || c.status === "human_confirmed";
    if (!isHuman && c.confidence < opts.minConfidence) return false;
    if (opts.maxEvidenceAgeDays !== undefined && c.observed_at) {
      const ageDays = (opts.now.getTime() - c.observed_at.getTime()) / 86_400_000;
      if (ageDays > opts.maxEvidenceAgeDays) return false;
    }
    return true;
  });
}

/**
 * Orden determinista de prioridad entre claims del mismo predicado:
 * humano > más reciente por observed_at > mayor confianza > id (desempate estable).
 */
export function byPriority(a: Claim, b: Claim): number {
  const ha = a.status === "human_confirmed" || a.evidence_modality === "human" ? 1 : 0;
  const hb = b.status === "human_confirmed" || b.evidence_modality === "human" ? 1 : 0;
  if (ha !== hb) return hb - ha;
  const ta = a.observed_at?.getTime() ?? 0;
  const tb = b.observed_at?.getTime() ?? 0;
  if (ta !== tb) return tb - ta;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return a.id.localeCompare(b.id);
}

/** Número de evidencias independientes: posts distintos (o claims sin post, cada uno cuenta). */
export function independentEvidenceCount(claims: Claim[]): number {
  const seen = new Set<string>();
  let loose = 0;
  for (const c of claims) {
    if (c.evidence_content_id) seen.add(c.evidence_content_id); else loose++;
  }
  return seen.size + loose;
}
