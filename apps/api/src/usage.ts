import type { Tx } from "./db.js";

export type Channel = "web" | "whatsapp";

/** Append a metering row for the current tenant (usage limits and billing later read this table). */
export async function recordUsage(tx: Tx, eventType: string, channel: Channel | null, metadata: Record<string, unknown> = {}) {
  await tx.query(
    `INSERT INTO usage_events (tenant_id, event_type, channel, metadata) VALUES (current_tenant_id(), $1, $2, $3)`,
    [eventType, channel, JSON.stringify(metadata)],
  );
}
