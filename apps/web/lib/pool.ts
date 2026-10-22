import pg from "pg";
const g = globalThis as unknown as { __scoutPool?: pg.Pool };
/** Pool compartido para Auth.js. El motor (@scout/core) usa el suyo con la misma DATABASE_URL. */
export const pool = g.__scoutPool ?? new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://scout:scout@localhost:5433/scoutting" });
g.__scoutPool = pool;
