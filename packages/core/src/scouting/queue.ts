import { PgBoss } from "pg-boss";
import { config } from "../config.js";

export const SCOUTING_QUEUE = "scouting.run";
let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  // La web solo encola: no migra ni supervisa (corre con el rol scout_app, sin permisos de DDL).
  const clientOnly = process.env.SCOUT_PROCESS === "web";
  const b = new PgBoss({ connectionString: config.databaseUrl, schema: "pgboss", ...(clientOnly ? { migrate: false, supervise: false, schedule: false } : {}) });
  b.on("error", (e: Error) => console.error("[pg-boss]", e));
  await b.start();
  if (!clientOnly) await b.createQueue(SCOUTING_QUEUE, { retryLimit: 1, expireInSeconds: 12 * 3600 }).catch(() => {});
  boss = b;
  return b;
}

export async function enqueueScouting(scoutingId: string): Promise<string | null> {
  const b = await getBoss();
  return b.send(SCOUTING_QUEUE, { scoutingId }, { singletonKey: scoutingId });
}

export async function stopBoss(): Promise<void> { if (boss) { await boss.stop({ graceful: true }); boss = null; } }
