import type { Predicate } from "../schema/predicate.js";
import { validateValue } from "../schema/predicate.js";
import type { NewClaim } from "../schema/claim.js";
import { loadContent, scopeHash, textOf, type ContentItem } from "./content.js";
import { insertClaims } from "./claims.js";
import { isCovered, recordJob } from "./jobs.js";
import type { JevAnswer } from "./jev.js";
import { classifier } from "./classifier.js";
import { extractor } from "./extractor.js";

export interface ExtractSummary { creatorId: string; claims: number; costUsd: number; skipped: string[]; ran: string[] }

/**
 * Extrae un conjunto de predicados para una creadora, respetando cobertura previa.
 * Es la misma función para macro (ingesta) y micro (bajo demanda): solo cambia la lista.
 */
export async function extractPredicates(creatorId: string, handle: string, predicates: Predicate[], opts: { force?: boolean } = {}): Promise<ExtractSummary> {
  const maxItems = Math.max(...predicates.map((p) => p.extraction_spec.scope.max_items), 10);
  const items = await loadContent(creatorId, maxItems);
  const scope = scopeHash(items);
  const summary: ExtractSummary = { creatorId, claims: 0, costUsd: 0, skipped: [], ran: [] };
  const pending: Predicate[] = [];
  for (const p of predicates) {
    const provider = p.extraction_spec.provider;
    if (provider === "external_api" || provider === "none" || provider === "metrics") continue;
    if (!opts.force && await isCovered({ creatorId, predicateKey: p.key, version: p.version, scope, provider })) { summary.skipped.push(p.key); continue; }
    pending.push(p);
  }
  if (!pending.length) return summary;

  const newClaims: NewClaim[] = [];
  const jevPreds = pending.filter((p) => p.extraction_spec.provider === "jev" && p.extraction_spec.jev);
  const claudePreds = pending.filter((p) => p.extraction_spec.provider === "claude");

  if (jevPreds.length) {
    const cls = classifier();
    // Un "estado" por texto (bio, caption, transcript); las preguntas aplicables dependen de la modalidad.
    const states: Array<{ id: string; text: string; item: ContentItem; t: { modality: "bio" | "caption" | "transcript" | "vision"; text: string } }> = [];
    for (const it of items) for (const t of textOf(it)) states.push({ id: `${it.id}:${t.modality}`, text: t.text, item: it, t });
    let cost = 0;
    const byModality = new Map<string, typeof states>();
    for (const s of states) { const arr = byModality.get(s.t.modality) ?? []; arr.push(s); byModality.set(s.t.modality, arr); }
    for (const [modality, group] of byModality) {
      const applicable = jevPreds.filter((p) => p.extraction_spec.modalities.includes(modality as "bio"));
      if (!applicable.length) continue;
      const questions = Object.fromEntries(applicable.map((p) => [p.key, p.extraction_spec.jev!]));
      const res = await cls.classify(group.map((g) => ({ id: g.id, text: g.text })), questions);
      cost += res.costUsd;
      for (const g of group) {
        const ans = res.answers.get(g.id) ?? {};
        for (const p of applicable) {
          const claim = answerToClaim(p, ans[p.key], g.item, g.t, cls.label);
          if (claim) newClaims.push(claim);
        }
      }
    }
    for (const p of jevPreds) {
      await recordJob({ creatorId, predicateKey: p.key, version: p.version, scope, provider: cls.mode }, "done", cost / jevPreds.length);
      summary.ran.push(p.key);
    }
    summary.costUsd += cost;
  }

  if (claudePreds.length) {
    const ex = extractor();
    const itemIds = new Set(items.map((i) => i.id));
    const res = await ex.extract(handle, items, claudePreds);
    for (const c of res.claims) {
      const p = claudePreds.find((x) => x.key === c.predicate_key);
      if (!p) continue;
      const err = validateValue(p, c.value);
      if (err) { console.warn(`[claude] claim descartado: ${err}`); continue; }
      if (!itemIds.has(c.evidence_content_id)) { console.warn(`[claude] claim descartado: evidencia ${c.evidence_content_id} no está en el alcance`); continue; }
      const item = items.find((i) => i.id === c.evidence_content_id)!;
      newClaims.push({
        creator_id: creatorId, predicate_key: p.key, predicate_version: p.version, value: c.value, polarity: c.polarity,
        observed_at: item.posted_at, evidence_content_id: item.id, evidence_span: c.evidence_span.slice(0, 300),
        evidence_modality: c.evidence_modality, confidence: c.confidence,
        extractor: { provider: "llm", mode: ex.mode, model: ex.label },
      });
    }
    for (const p of claudePreds) {
      await recordJob({ creatorId, predicateKey: p.key, version: p.version, scope, provider: ex.mode === "live" ? "llm" : "mock" }, "done", res.costUsd / claudePreds.length);
      summary.ran.push(p.key);
    }
    summary.costUsd += res.costUsd;
  }

  summary.claims = await insertClaims(newClaims);
  return summary;
}

function answerToClaim(p: Predicate, a: JevAnswer | undefined, item: ContentItem, t: { modality: "bio" | "caption" | "transcript" | "vision"; text: string }, label: string): NewClaim | null {
  if (!a) return null;
  const spec = p.extraction_spec.jev!;
  let value: unknown; let confidence: number;
  if (a.type === "noul") {
    if ((a.noul ?? 0) < 0.5) return null;
    value = true; confidence = a.noul ?? 0;
  } else if (a.type === "choice") {
    const label = a.choice ?? "";
    if (!label || spec.none_labels.includes(label)) return null;
    value = spec.value_map?.[label] ?? label;
    confidence = a.probabilities?.[label] ?? a.confidence ?? 0;
  } else {
    value = a.score ?? 0; confidence = a.confidence ?? 0;
  }
  if (validateValue(p, value)) return null;
  return {
    creator_id: item.creator_id, predicate_key: p.key, predicate_version: p.version, value, polarity: "affirms",
    observed_at: item.posted_at, evidence_content_id: item.id, evidence_span: t.text.slice(0, 200), evidence_modality: t.modality,
    confidence: Number(confidence.toFixed(4)), extractor: { provider: "classifier", model: label },
  };
}
