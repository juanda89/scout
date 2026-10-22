import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const { Pool } = pg;
let _pool: pg.Pool | null = null;

/** Algo sobre lo que se puede ejecutar query(): el pool o el cliente de la transacción del usuario actual. */
export type Queryable = Pick<pg.Pool, "query">;

const userContext = new AsyncLocalStorage<pg.PoolClient>();

export function pool(): pg.Pool {
  if (!_pool) _pool = new Pool({ connectionString: config.databaseUrl });
  return _pool;
}

/** Dentro de runAsUser devuelve el cliente con app.user_id fijado (RLS); fuera, el pool. */
export function db(): Queryable {
  return userContext.getStore() ?? pool();
}

/**
 * Ejecuta fn dentro de una transacción con `app.user_id` = userId, de modo que las políticas RLS
 * solo dejen ver las filas de ese usuario. Toda consulta hecha vía db() dentro de fn usa esa conexión.
 */
export async function runAsUser<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const existing = userContext.getStore();
  if (existing) return fn();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
    const out = await userContext.run(client, fn);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (_pool) { await _pool.end(); _pool = null; }
}

/**
 * Rol de aplicación sin privilegios para la web. Solo se crea si APP_DB_PASSWORD está definido.
 * Idempotente; lo ejecutan las migraciones (CLI y worker) con el rol administrador.
 */
export async function ensureAppRole(): Promise<boolean> {
  const pw = process.env.APP_DB_PASSWORD;
  if (!pw) return false;
  const client = await pool().connect();
  try {
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scout_app') THEN CREATE ROLE scout_app LOGIN; END IF; END $$`);
    await client.query(`ALTER ROLE scout_app WITH LOGIN PASSWORD ${client.escapeLiteral(pw)}`);
    const grants = [
      `GRANT USAGE ON SCHEMA public TO scout_app`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scout_app`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scout_app`,
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO scout_app`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scout_app`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO scout_app`,
    ];
    for (const g of grants) await client.query(g);
    const { rowCount } = await client.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss'`);
    if (rowCount) {
      for (const g of [
        `GRANT USAGE ON SCHEMA pgboss TO scout_app`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO scout_app`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO scout_app`,
        `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO scout_app`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scout_app`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO scout_app`,
      ]) await client.query(g);
    }
    return true;
  } finally {
    client.release();
  }
}

export async function migrate(): Promise<string[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(here, "..", "..", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool().connect();
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
  await ensureAppRole();
  return applied;
}
