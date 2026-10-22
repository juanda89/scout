import { PgBoss } from "pg-boss";
import { config } from "../config.js";

export const SCOUTING_QUEUE = "scouting.run";
let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const b = new PgBoss({ connectionString: config.databaseUrl, schema: "pgboss" });
  b.on("error", (e: Error) => console.error("[pg-boss]", e));
  await b.start();
  await b.createQueue(SCOUTING_QUEUE, { retryLimit: 1, expireInSeconds: 12 * 3600 }).catch(() => {});
  boss = b;
  return b;
}

export async function enqueueScouting(scoutingId: string): Promise<string | null> {
  const b = await getBoss();
  return b.send(SCOUTING_QUEUE, { scoutingId }, { singletonKey: scoutingId });
}

export async function stopBoss(): Promise<void> { if (boss) { await boss.stop({ graceful: true }); boss = null; } }
