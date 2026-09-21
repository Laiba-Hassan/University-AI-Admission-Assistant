import pg from "pg";
import { config } from "./config.js";

// Return SQL `date` columns as plain "YYYY-MM-DD" strings. The default parser builds a local-time JS Date, and
// converting that back with toISOString() shifts every date by a day in timezones ahead of UTC (a deadline of
// 2026-12-15 became 2026-12-14). Dates here are calendar dates, not instants.
pg.types.setTypeParser(1082, (v) => v);

export type Tx = pg.PoolClient;

// The application connects as app_user: not an owner, no BYPASSRLS (PRD Section 3).
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction whose tenant context is set with SET LOCAL semantics (set_config(..., true)),
 * so it disappears at COMMIT/ROLLBACK and can never leak to the next user of a pooled connection.
 * Every query touching tenant data goes through here.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("withTenant: invalid tenant id");
  return inTransaction(async (tx) => {
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(tx);
  });
}

/** A transaction with NO tenant context: for the resolver functions and platform-level tables only. */
export async function withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(fn);
}

async function inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Refuse to run if the connection could bypass RLS (superuser, BYPASSRLS, or table owner). */
export async function assertRestrictedRole(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT current_user AS name, r.rolsuper, r.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owns_tables
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const r = rows[0];
  if (!r || r.rolsuper || r.rolbypassrls || r.owns_tables) {
    throw new Error(`DATABASE_URL role "${r?.name}" can bypass row-level security; connect as app_user`);
  }
}
