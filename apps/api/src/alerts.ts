import type { Tx } from "./db.js";

/** New lead/handoff events since a point in time -- never the student's name or phone (event_outbox.payload is
 * already scrubbed of both by the writers in agent/tools.ts and conversations.ts). Polled, not LISTEN/NOTIFY: one
 * Postgres instance, a handful of tenants, a 3s poll is simpler and just as real for this scale. */
export async function pollAlerts(tx: Tx, since: Date) {
  return (await tx.query(
    `SELECT id, event_type, payload, created_at FROM event_outbox
     WHERE event_type IN ('lead_created', 'handoff_requested') AND created_at > $1
     ORDER BY created_at ASC LIMIT 50`, [since])).rows as { id: string; event_type: string; payload: Record<string, unknown>; created_at: Date }[];
}
