import { db } from "../db.js";

export interface Quota { used: number; limit: number; remaining: number; unlimited: boolean }

/** Cupo del usuario tal como lo calcula la base de datos (misma lógica que el trigger). */
export async function quotaFor(userId: number): Promise<Quota> {
  const { rows } = await db().query(`SELECT user_scoutings_used($1)::int AS used, user_quota($1)::int AS q`, [userId]);
  const used = Number(rows[0]?.used ?? 0), limit = Number(rows[0]?.q ?? 0);
  const unlimited = limit >= 1_000_000;
  return { used, limit, remaining: unlimited ? Number.POSITIVE_INFINITY : Math.max(0, limit - used), unlimited };
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof Error && /quota_exceeded/.test(e.message);
}

/** Sincroniza los ajustes globales desde el entorno (lo hace el worker y `scout db migrate`). */
export async function syncQuotaSettings(): Promise<void> {
  const quota = process.env.SCOUT_QUOTA_PER_USER;
  const admins = process.env.ADMIN_EMAILS;
  if (quota !== undefined) await db().query(`INSERT INTO app_settings (key, value) VALUES ('quota_per_user', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [String(Number(quota) || 2)]);
  if (admins !== undefined) await db().query(`INSERT INTO app_settings (key, value) VALUES ('admin_emails', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [admins.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).join(",")]);
}
