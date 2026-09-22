import { pool } from "./db.js";

// Fixed-window rate limiting (PRD Section 11: per-IP, per-session, per-tenant). A single atomic upsert avoids a
// check-then-increment race between concurrent requests. Runs on the plain pool (app_user, no tenant context needed
// -- rate_limit_buckets is not tenant-owned, same as access_requests).
export interface Limit { key: string; windowSeconds: number; max: number }

/** Returns true if this call is allowed (and counts it); false if the limit for this window is already reached. */
export async function checkLimit({ key, windowSeconds, max }: Limit): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const { rows } = await pool.query(
    `INSERT INTO rate_limit_buckets (bucket_key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
     RETURNING count`,
    [key, windowStart],
  );
  return (rows[0]?.count ?? 0) <= max;
}

/** Checks several limits at once (e.g. per-IP, per-session, per-tenant); the caller decides how to react. */
export async function checkLimits(limits: Limit[]): Promise<{ ok: boolean; failed: string[] }> {
  const results = await Promise.all(limits.map(async (l) => ({ key: l.key, ok: await checkLimit(l) })));
  return { ok: results.every((r) => r.ok), failed: results.filter((r) => !r.ok).map((r) => r.key) };
}

/** Deletes windows older than `olderThanSeconds`. Opportunistic housekeeping; not a scheduled job for V1.3. */
export async function pruneOldBuckets(olderThanSeconds = 3600): Promise<number> {
  const { rowCount } = await pool.query("DELETE FROM rate_limit_buckets WHERE window_start < $1", [new Date(Date.now() - olderThanSeconds * 1000)]);
  return rowCount ?? 0;
}
