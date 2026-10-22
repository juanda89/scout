import { getBoss, SCOUTING_QUEUE } from "@scout/core/scouting/queue";
import { runScoutingPipeline } from "@scout/core/scouting/pipeline";
import { getScouting } from "@scout/core/scouting/repo";
import { db, migrate } from "@scout/core/db";
import { seedRegistry } from "@scout/core/registry/registry";
import { sendResultsEmail } from "./notify.js";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

async function main() {
  const applied = await migrate();
  if (applied.length) console.log(`[worker] migraciones aplicadas: ${applied.join(", ")}`);
  await seedRegistry();
  const boss = await getBoss();
  console.log(`[worker] escuchando cola ${SCOUTING_QUEUE}`);
  await boss.work<{ scoutingId: string }>(SCOUTING_QUEUE, { batchSize: 1, pollingIntervalSeconds: 2 }, async (jobs) => {
    for (const job of jobs) {
      const { scoutingId } = job.data;
      console.log(`[worker] scouting ${scoutingId} inicio`);
      const t0 = Date.now();
      await runScoutingPipeline(scoutingId, { log: (m) => console.log(`  ${scoutingId.slice(0, 8)} ${m}`) });
      const s = await getScouting(scoutingId);
      console.log(`[worker] scouting ${scoutingId} ${s?.status} en ${Math.round((Date.now() - t0) / 1000)} s`);
      if (s?.status === "done" && s.notify_email && s.owner_id) {
        const { rows } = await db().query(`SELECT email FROM users WHERE id = $1`, [s.owner_id]);
        const email = rows[0]?.email as string | undefined;
        if (email) await sendResultsEmail(email, s.name, `${APP_URL}/scoutings/${s.id}`, `${s.metrics.strong ?? 0} strong candidates out of ${s.metrics.profiles_analyzed ?? 0} profiles analyzed.`).catch((e) => console.error("[notify]", e));
      }
    }
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
process.on("SIGTERM", () => process.exit(0));
