import type { BriefSpec } from "../schema/brief.js";
import type { Predicate } from "../schema/predicate.js";
import { PredicateSchema } from "../schema/predicate.js";

export const NUMERIC_FACETS = new Set(["followers", "er_estimate"]);

/** Comprueba que la spec sea ejecutable contra el registro (más los predicados nuevos que propone). */
export function validateSpec(spec: BriefSpec, registry: Map<string, Predicate>): string[] {
  const errors: string[] = [];
  const known = new Map(registry);
  for (const np of spec.new_predicates) {
    const parsed = PredicateSchema.safeParse(np);
    if (!parsed.success) { errors.push(`predicado nuevo ${np.key}: ${parsed.error.issues.map((i) => i.message).join("; ")}`); continue; }
    if (known.has(np.key) && known.get(np.key)!.tier !== np.tier) errors.push(`predicado nuevo ${np.key} choca con uno existente de otro tier`);
    known.set(np.key, parsed.data);
  }
  for (const [key, f] of Object.entries(spec.macro_filters)) {
    if (NUMERIC_FACETS.has(key)) {
      if (f.eq !== undefined || f.any_of || f.none_of) errors.push(`filtro macro ${key}: solo admite between/gte/lte`);
      continue;
    }
    const p = known.get(key);
    if (!p) { errors.push(`filtro macro sobre predicado desconocido: ${key}`); continue; }
    if (p.tier !== "macro") errors.push(`filtro macro sobre predicado micro: ${key} (debe ir en requirements)`);
    if (f.between || f.gte !== undefined || f.lte !== undefined) errors.push(`filtro macro ${key}: between/gte/lte solo para followers/er_estimate`);
    const values: unknown[] | undefined = Array.isArray(p.value_schema.values) ? p.value_schema.values : undefined;
    if (values) {
      for (const v of [f.eq, ...(f.any_of ?? []), ...(f.none_of ?? [])].filter((x) => x !== undefined)) {
        if (!values.includes(v)) errors.push(`filtro macro ${key}: valor '${String(v)}' no está en el enum`);
      }
    }
  }
  const ids = new Set<string>();
  for (const r of spec.requirements) {
    if (ids.has(r.id)) errors.push(`requisito duplicado: ${r.id}`);
    ids.add(r.id);
    const p = known.get(r.predicate);
    if (!p) { errors.push(`requisito ${r.id}: predicado desconocido ${r.predicate}`); continue; }
    if (r.rule.derived) {
      const providers = [...known.values()].filter((x) => x.derivations.some((d) => d.name === r.rule.derived));
      if (!providers.length) errors.push(`requisito ${r.id}: ningún predicado deriva ${r.rule.derived}`);
    }
    if (["between", "gte", "lte"].includes(r.rule.op) && !r.rule.derived && p.value_type !== "number") errors.push(`requisito ${r.id}: operador numérico sobre predicado ${p.value_type}`);
    if (!r.hard && r.weight === undefined) errors.push(`requisito blando ${r.id} sin weight`);
  }
  const softW = spec.requirements.filter((r) => !r.hard).reduce((a, r) => a + (r.weight ?? 0), 0);
  if (softW > 0 && Math.abs(softW - 1) > 0.01) errors.push(`los weights de requisitos blandos suman ${softW.toFixed(2)}, deberían sumar 1`);
  return errors;
}
