import { Command } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";
import { closeDb, db, migrate } from "./db.js";
import { isLive } from "./config.js";
import { classifier } from "./extract/classifier.js";
import { extractor } from "./extract/extractor.js";
import { listPredicates, predicateMap, seedRegistry } from "./registry/registry.js";
import { loadFixtureCreators } from "./ingest/fixtures.js";
import { ingestFromApify } from "./ingest/apify.js";
import { findCreatorByHandle, storeCreators } from "./ingest/store.js";
import { extractPredicates } from "./extract/run.js";
import { insertHumanClaim, listClaims, queryClaims } from "./extract/claims.js";
import { refreshFacets } from "./funnel/facets.js";
import { compileBrief } from "./brief/compile.js";
import { validateSpec } from "./brief/validate.js";
import { approveSpec, createBrief, getSpec, resolveBriefId, saveSpec } from "./brief/store.js";
import { runBrief } from "./funnel/run.js";
import { llm } from "./llm/client.js";
import { jev } from "./extract/jev.js";
import { creatordbUsage, enrichAudience } from "./enrich/creatordb.js";
import { z } from "zod/v4";

const program = new Command().name("scout").description("Scouting determinista de creadoras (ver docs/ARQUITECTURA.md)");

function modes(): string {
  return `clasificador=${classifier().label} extractor=${extractor().label} apify=${isLive("apify") ? "live" : "mock"} creatordb=${isLive("creatordb") ? "live" : "mock"}`;
}

async function allCreators(): Promise<Array<{ id: string; handle: string }>> {
  const { rows } = await db().query(`SELECT id, handle FROM creators ORDER BY handle`);
  return rows;
}

const dbCmd = program.command("db").description("Base de datos");
dbCmd.command("migrate").description("Aplica migraciones").action(async () => {
  const applied = await migrate();
  console.log(applied.length ? `migraciones aplicadas: ${applied.join(", ")}` : "sin migraciones pendientes");
});

dbCmd.command("reset").description("BORRA todo el esquema y vuelve a migrar (solo desarrollo)").requiredOption("--yes").action(async () => {
  await db().query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  console.log(`esquema recreado; migraciones: ${(await migrate()).join(", ")}`);
});

const reg = program.command("registry").description("Registro de predicados");
reg.command("seed").description("Carga el vocabulario macro inicial").action(async () => {
  console.log(`predicados sembrados: ${await seedRegistry()}`);
});
reg.command("list").option("--tier <tier>").action(async (o: { tier?: "macro" | "micro" }) => {
  for (const p of await listPredicates(o.tier)) {
    console.log(`${p.tier.padEnd(5)} ${p.key.padEnd(30)} ${p.value_type.padEnd(8)} ${p.cardinality.padEnd(4)} ${p.temporal_kind.padEnd(13)} ${p.extraction_spec.provider.padEnd(12)} v${p.version}${p.derivations.length ? "  deriva: " + p.derivations.map((d) => d.name).join(",") : ""}`);
  }
});

const ingest = program.command("ingest").description("Ingesta de creadoras");
ingest.command("fixtures [file]").description("Carga creadoras desde un JSON local").action(async (file?: string) => {
  const f = file ?? path.resolve("fixtures", "creators.sample.json");
  const r = await storeCreators(loadFixtureCreators(f));
  console.log(`creadoras: ${r.creators}, posts: ${r.posts}`);
});
ingest.command("apify").description("Ingesta vía Apify (requiere APIFY_TOKEN)")
  .option("--hashtags <list>", "hashtags separados por coma")
  .option("--profiles <list>", "handles separados por coma")
  .option("--limit <n>", "máximo de items", "200")
  .action(async (o: { hashtags?: string; profiles?: string; limit: string }) => {
    const creators = await ingestFromApify({ hashtags: o.hashtags?.split(","), profiles: o.profiles?.split(","), limit: Number(o.limit), log: (m) => console.log("  " + m) });
    const r = await storeCreators(creators);
    for (const c of creators) console.log(`  @${c.handle.padEnd(22)} ${String(c.followers ?? "?").padStart(9)} seg.  ${c.posts.length} posts  bio: ${(c.bio ?? "").replace(/\n/g, " ").slice(0, 70)}`);
    console.log(`creadoras: ${r.creators}, posts: ${r.posts}`);
  });

program.command("extract-macro").description("Extrae el vocabulario macro para todas las creadoras (o una) y refresca facetas")
  .option("--handle <handle>").option("--force", "ignora cobertura previa")
  .action(async (o: { handle?: string; force?: boolean }) => {
    console.log(`modos: ${modes()}`);
    const macro = await listPredicates("macro");
    const targets = o.handle ? [await findCreatorByHandle(o.handle)].filter((x): x is NonNullable<typeof x> => !!x) : await allCreators();
    let total = 0, cost = 0;
    for (const c of targets) {
      const s = await extractPredicates(c.id, c.handle, macro, { force: o.force });
      const facets = await refreshFacets(c.id);
      total += s.claims; cost += s.costUsd;
      console.log(`@${c.handle.padEnd(22)} claims+${String(s.claims).padStart(3)} ${s.skipped.length ? `(cubiertos: ${s.skipped.length})` : ""} facetas: ${JSON.stringify(facets)}`);
    }
    console.log(`total claims: ${total}, costo estimado: ${cost.toFixed(4)} USD`);
  });

const brief = program.command("brief").description("Briefs");
brief.command("compile <file>").description("Compila un brief en texto a BriefSpec (no ejecuta nada)")
  .option("--title <title>")
  .action(async (file: string, o: { title?: string }) => {
    console.log(`modos: ${modes()}`);
    const text = readFileSync(file, "utf8");
    const registry = await listPredicates();
    const { spec, compiledBy } = await compileBrief(text, registry, o.title);
    const errors = validateSpec(spec, new Map(registry.map((p) => [p.key, p])));
    const briefId = await createBrief(spec.title, text);
    const { version } = await saveSpec(briefId, spec, { ...compiledBy, validation_errors: errors });
    console.log(JSON.stringify(spec, null, 2));
    console.log(`\nbrief ${briefId} spec v${version}${errors.length ? `\nERRORES DE VALIDACIÓN:\n - ${errors.join("\n - ")}` : "\nvalidación OK"}`);
    console.log(`siguiente: scout brief approve ${briefId} --by <tu-nombre>`);
  });
brief.command("approve <brief>").description("Aprueba la última spec: registra predicados nuevos y la habilita para correr")
  .requiredOption("--by <name>").option("--version <n>")
  .action(async (b: string, o: { by: string; version?: string }) => {
    const id = await resolveBriefId(b);
    const s = await getSpec(id, { version: o.version ? Number(o.version) : undefined });
    if (!s) throw new Error("spec no encontrada");
    const errors = validateSpec(s.spec, await predicateMap());
    if (errors.length) { console.error(`no se puede aprobar:\n - ${errors.join("\n - ")}`); process.exitCode = 1; return; }
    const registered = await approveSpec(s.id, o.by);
    console.log(`spec v${s.version} aprobada por ${o.by}. predicados registrados: ${registered.length ? registered.join(", ") : "ninguno"}`);
  });
brief.command("run <brief>").description("Ejecuta el embudo con la última spec aprobada")
  .action(async (b: string) => {
    console.log(`modos: ${modes()}`);
    const id = await resolveBriefId(b);
    const s = await getSpec(id, { approvedOnly: true });
    if (!s) throw new Error("no hay spec aprobada; usa `scout brief approve`");
    const report = await runBrief(s.id, s.spec, { log: (m) => console.log("  " + m) });
    console.log(`\nrun ${report.runId}  etapas: ${JSON.stringify(report.stageCounts)}  costo estimado: ${report.costUsd.toFixed(4)} USD\n`);
    for (const r of report.rows) {
      console.log(`${r.evaluation.overall.padEnd(7)} score ${r.evaluation.score.toFixed(2)}  @${r.candidate.handle}  (${r.candidate.followers ?? "?"} seg.)`);
      for (const x of r.evaluation.results) {
        const req = s.spec.requirements.find((q) => q.id === x.requirement_id)!;
        console.log(`    ${req.hard ? "[duro] " : "[blando]"} ${x.requirement_id.padEnd(22)} ${x.verdict.padEnd(7)} ${x.reason}${x.values.length ? "  valores=" + JSON.stringify(x.values) : ""}`);
      }
    }
  });

program.command("llm-probe").description("Prueba los modelos configurados (clasificación y razonamiento) con una llamada mínima")
  .action(async () => {
    const S = z.object({ items: z.array(z.object({ id: z.string(), life_stage: z.enum(["parent", "pregnant", "unknown"]), confidence: z.number(), country: z.string().nullable() })) });
    const j = jev();
    if (j.mode === "live") {
      const t = Date.now();
      const r = await j.ask("Hoy mi bebé cumple 6 meses y ya se sienta solita | Madrid", {
        life_stage: { type: "choice", instructions: "Etapa de vida de la autora", criteria: { parent: "Habla de su hijo o hija", pregnant: "Embarazada", unknown: "Sin evidencia" }, none_labels: ["unknown"] },
        es_patrocinio: { type: "noul", instructions: "El texto es una colaboración pagada", none_labels: [] },
      });
      console.log(`jev: live ${Date.now() - t}ms in=${r.inputTokens} cost=$${r.costUsd.toFixed(6)}\n  ${JSON.stringify(r.answers)}`);
    } else console.log("jev: sin clave (mock)");
    if (isLive("creatordb")) {
      const u = await creatordbUsage();
      console.log(`creatordb: live  créditos disponibles=${u.creditsAvailable} (plan ${u.planCreditsAvailable}, comprados ${u.purchasedCreditsAvailable})`);
    } else console.log("creatordb: sin clave (mock)");
    for (const role of ["classify", "reasoning"] as const) {
      const c = llm(role);
      if (!c) { console.log(`${role}: sin proveedor (mock)`); continue; }
      const t = Date.now();
      const r = await c.complete({ system: "Clasifica cada texto. Responde solo JSON.", user: JSON.stringify([{ id: "a", text: "Hoy mi bebé cumple 6 meses | Madrid" }, { id: "b", text: "Guatapé en un día: qué ver" }]), schema: S, schemaName: "cls" });
      console.log(`${role}: ${c.provider}/${c.model} ${Date.now() - t}ms in=${r.inputTokens} out=${r.outputTokens} cost=$${r.costUsd.toFixed(6)}\n  ${JSON.stringify(r.data)}`);
    }
  });

program.command("enrich <handle>").description("Trae la demografía de audiencia (CreatorDB) de una creadora y la guarda como claims")
  .option("--force", "ignora cobertura previa")
  .action(async (handle: string, o: { force?: boolean }) => {
    const c = await findCreatorByHandle(handle);
    if (!c) throw new Error("creadora no encontrada");
    const r = await enrichAudience(c.id, c.handle, { force: o.force });
    if (!r.ran) { console.log("ya estaba cubierta (usa --force para repetir)"); return; }
    const { raw, ...d } = r.data!;
    console.log(`${JSON.stringify(d)}  costo=${r.costUsd.toFixed(2)} USD`);
  });

program.command("claims <handle>").description("Lista los claims de una creadora con su evidencia")
  .option("--predicate <key>")
  .action(async (handle: string, o: { predicate?: string }) => {
    const c = await findCreatorByHandle(handle);
    if (!c) throw new Error("creadora no encontrada");
    const claims = await listClaims(c.id, o.predicate ? [o.predicate] : undefined);
    const { rows: items } = await db().query(`SELECT id, platform_post_id, posted_at FROM content_items WHERE creator_id = $1`, [c.id]);
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const cl of claims) {
      const it = cl.evidence_content_id ? byId.get(cl.evidence_content_id) : null;
      console.log(`${cl.status.padEnd(15)} ${cl.predicate_key.padEnd(26)} ${JSON.stringify(cl.value).padEnd(28)} ${cl.polarity.padEnd(7)} conf=${cl.confidence.toFixed(2)} obs=${cl.observed_at?.toISOString().slice(0, 10) ?? "-"} post=${it?.platform_post_id ?? "-"} "${(cl.evidence_span ?? "").slice(0, 60)}"`);
    }
  });

program.command("review <run_id> <handle> <decision>").description("Decisión humana: accept | reject | needs_more. Con --predicate crea un claim humano")
  .requiredOption("--by <name>").option("--note <text>").option("--predicate <key>").option("--value <json>").option("--deny", "el claim humano niega el hecho")
  .action(async (runId: string, handle: string, decision: string, o: { by: string; note?: string; predicate?: string; value?: string; deny?: boolean }) => {
    const c = await findCreatorByHandle(handle);
    if (!c) throw new Error("creadora no encontrada");
    let claimId: string | null = null;
    if (o.predicate) {
      claimId = await insertHumanClaim({ creatorId: c.id, predicateKey: o.predicate, value: o.value ? JSON.parse(o.value) : true, polarity: o.deny ? "denies" : "affirms", reviewer: o.by, note: o.note, supersedeAuto: decision === "reject" });
      await refreshFacets(c.id);
    }
    await db().query(`INSERT INTO review_decisions (run_id, creator_id, decision, reviewer, note, claim_id) VALUES ($1,$2,$3,$4,$5,$6)`, [runId, c.id, decision, o.by, o.note ?? null, claimId]);
    console.log(`decisión registrada${claimId ? ` con claim humano ${claimId}` : ""}`);
  });

program.command("query <predicate>").description("Consulta transversal: quién tiene un claim vigente de ese predicado")
  .option("--value <json>")
  .action(async (predicate: string, o: { value?: string }) => {
    const rows = await queryClaims(predicate, o.value !== undefined ? JSON.parse(o.value) : undefined);
    for (const r of rows) console.log(`@${r.handle.padEnd(22)} ${JSON.stringify(r.value).padEnd(28)} conf=${Number(r.confidence).toFixed(2)} ${r.status} obs=${r.observed_at ? new Date(r.observed_at).toISOString().slice(0, 10) : "-"}`);
    console.log(`${rows.length} claims`);
  });

program.hook("postAction", async () => { await closeDb(); });
program.parseAsync(process.argv).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closeDb(); process.exit(1); });
