import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const { Pool } = pg;
let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) pool = new Pool({ connectionString: config.databaseUrl });
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}

export async function migrate(): Promise<string[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, "..", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = await db().connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    for (const f of files) {
      const { rowCount } = await client.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [f]);
      if (rowCount) continue;
      await client.query("BEGIN");
      await client.query(readFileSync(path.join(dir, f), "utf8"));
      await client.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [f]);
      await client.query("COMMIT");
      applied.push(f);
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return applied;
}
