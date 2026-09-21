import { PgBoss } from "pg-boss";
import { config } from "./config.js";
import { withTenant } from "./db.js";

export const QUEUES = { whatsappInbound: "whatsapp.inbound" } as const;
export type Enqueue = (queue: string, data: { tenantId: string } & Record<string, unknown>) => Promise<string | null>;

// Job payloads always carry the tenant id; workers re-enter tenant context with withTenant() before touching data.
// The pgboss schema is job plumbing owned by its own role (app_queue) and is not exposed to tenants. Jobs are kept
// for a day after completion only, because inbound webhook payloads can contain student messages.
export async function startQueue() {
  const boss = new PgBoss(config.DATABASE_URL_QUEUE);
  boss.on("error", (err) => console.error("queue error:", err.message));
  await boss.start();
  await boss.createQueue(QUEUES.whatsappInbound, { retryLimit: 3, retryBackoff: true, deleteAfterSeconds: 86_400 });

  // Placeholder consumer: proves tenant-scoped job handling end to end. Phase 6A replaces it with the real
  // conversation-core call (idempotent on the WhatsApp message id).
  await boss.work<{ tenantId: string }>(QUEUES.whatsappInbound, async ([job]) => {
    if (!job) return;
    await withTenant(job.data.tenantId, async () => {
      console.log(`whatsapp.inbound job ${job.id} accepted for a tenant`);
    });
  });

  const enqueue: Enqueue = (queue, data) => boss.send(queue, data);
  return { boss, enqueue, stop: () => boss.stop({ graceful: true, timeout: 10_000 }) };
}
