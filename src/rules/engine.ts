import type { Claim } from "../schema/claim.js";
import type { Predicate } from "../schema/predicate.js";
import type { BriefSpec, Requirement, Rule } from "../schema/brief.js";
import { derive, predicatesProviding } from "./derivations.js";
import { byPriority, independentEvidenceCount, vigentes } from "./resolve.js";

export type Verdict = "PASS" | "FAIL" | "UNKNOWN";

export interface RequirementResult {
  requirement_id: string;
  verdict: Verdict;
  reason: string;
  claim_ids: string[];
  values: unknown[];
}

export interface CreatorEvaluation {
  overall: Verdict;
  score: number;
  results: RequirementResult[];
  evidence_claim_ids: string[];
}

export interface EngineContext {
  now: Date;
  predicates: Map<string, Predicate>;
  defaultMinConfidence: number;
}

/** Evalúa un operador contra un valor. Puro. */
export function testRule(rule: Rule, value: unknown): boolean {
  switch (rule.op) {
    case "eq": return value === rule.value;
    case "in":
    case "any_of": return Array.isArray(rule.value) && rule.value.includes(value);
    case "none_of": return Array.isArray(rule.value) && !rule.value.includes(value);
    case "between": {
      if (typeof value !== "number" || !Array.isArray(rule.value)) return false;
      const [lo, hi] = rule.value as [number, number];
      return value >= lo && value <= hi;
    }
    case "gte": return typeof value === "number" && value >= Number(rule.value);
    case "lte": return typeof value === "number" && value <= Number(rule.value);
    case "contains": return Array.isArray(value) ? value.includes(rule.value) : typeof value === "string" && value.includes(String(rule.value));
    case "exists": return true;
    case "not_exists": return false;
  }
}

interface Candidate { claim: Claim; value: unknown }

/** Produce los pares (claim, valor) sobre los que se evalúa la regla, aplicando derivaciones si toca. */
function candidateValues(req: Requirement, claims: Claim[], ctx: EngineContext): Candidate[] {
  if (!req.rule.derived) {
    return claims.filter((c) => c.predicate_key === req.predicate).map((c) => ({ claim: c, value: c.value }));
  }
  const providers = predicatesProviding(req.rule.derived, ctx.predicates);
  const out: Candidate[] = [];
  for (const p of providers) {
    const d = p.derivations.find((x) => x.name === req.rule.derived)!;
    for (const c of claims) {
      if (c.predicate_key !== p.key) continue;
      const v = derive(d, c, ctx.now);
      if (v !== null) out.push({ claim: c, value: v });
    }
  }
  return out;
}

export function evaluateRequirement(req: Requirement, allClaims: Claim[], ctx: EngineContext): RequirementResult {
  const minConfidence = req.min_confidence ?? ctx.defaultMinConfidence;
  const relevantKeys = req.rule.derived
    ? new Set(predicatesProviding(req.rule.derived, ctx.predicates).map((p) => p.key))
    : new Set([req.predicate]);
  const scoped = allClaims.filter((c) => relevantKeys.has(c.predicate_key));
  const live = vigentes(scoped, { now: ctx.now, minConfidence, maxEvidenceAgeDays: req.max_evidence_age_days }).sort(byPriority);

  const base = { requirement_id: req.id, claim_ids: [] as string[], values: [] as unknown[] };

  if (req.rule.op === "not_exists") {
    const affirms = live.filter((c) => c.polarity === "affirms");
    if (affirms.length) return { ...base, verdict: "FAIL", reason: "existe evidencia que lo contradice", claim_ids: affirms.map((c) => c.id) };
    return { ...base, verdict: "PASS", reason: "sin evidencia en contra" };
  }

  // Un denies vigente más reciente que cualquier affirms fuerza FAIL.
  const newestDeny = live.find((c) => c.polarity === "denies");
  const newestAffirm = live.find((c) => c.polarity === "affirms");
  if (newestDeny && (!newestAffirm || byPriority(newestDeny, newestAffirm) < 0)) {
    return { ...base, verdict: "FAIL", reason: "evidencia explícita en contra", claim_ids: [newestDeny.id] };
  }

  const affirms = live.filter((c) => c.polarity === "affirms");
  if (!affirms.length) return { ...base, verdict: "UNKNOWN", reason: "sin evidencia suficiente" };

  const pred = ctx.predicates.get(req.predicate);
  const cardinality = pred?.cardinality ?? "many";
  const cands = candidateValues(req, affirms, ctx);
  if (!cands.length) return { ...base, verdict: "UNKNOWN", reason: "claims sin valor derivable" };

  // Cardinalidad one: solo cuenta el claim de mayor prioridad por valor resuelto.
  const pool = cardinality === "one" && !req.rule.derived ? [cands[0]] : cands;

  const satisfying = pool.filter((c) => testRule(req.rule, c.value));
  const values = pool.map((c) => c.value);

  if (req.match === "all" && satisfying.length !== pool.length) {
    return { ...base, verdict: "FAIL", reason: "no todos los valores cumplen", claim_ids: pool.map((c) => c.claim.id), values };
  }
  if (!satisfying.length) {
    return { ...base, verdict: "FAIL", reason: "la evidencia no cumple la regla", claim_ids: pool.map((c) => c.claim.id), values };
  }
  const n = independentEvidenceCount(satisfying.map((c) => c.claim));
  if (n < req.min_evidence) {
    return { ...base, verdict: "UNKNOWN", reason: `evidencia insuficiente (${n}/${req.min_evidence})`, claim_ids: satisfying.map((c) => c.claim.id), values: satisfying.map((c) => c.value) };
  }
  return { ...base, verdict: "PASS", reason: `${n} evidencia(s) independiente(s)`, claim_ids: satisfying.map((c) => c.claim.id), values: satisfying.map((c) => c.value) };
}

export function evaluateCreator(spec: BriefSpec, claims: Claim[], ctx: EngineContext): CreatorEvaluation {
  const results = spec.requirements.map((r) => evaluateRequirement(r, claims, ctx));
  const hard = spec.requirements.map((r, i) => ({ r, res: results[i] })).filter((x) => x.r.hard);
  let overall: Verdict = "PASS";
  if (hard.some((x) => x.res.verdict === "FAIL")) overall = "FAIL";
  else if (hard.some((x) => x.res.verdict === "UNKNOWN")) overall = "UNKNOWN";

  const soft = spec.requirements.map((r, i) => ({ r, res: results[i] })).filter((x) => !x.r.hard);
  const totalW = soft.reduce((a, x) => a + (x.r.weight ?? 1), 0) || 1;
  const score = soft.reduce((a, x) => a + (x.res.verdict === "PASS" ? (x.r.weight ?? 1) : 0), 0) / totalW;

  const evidence = [...new Set(results.flatMap((r) => r.claim_ids))];
  return { overall, score: Number(score.toFixed(4)), results, evidence_claim_ids: evidence };
}
