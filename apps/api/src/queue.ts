import { PgBoss } from "pg-boss";
import type { LlmProvider } from "./agent/llm.js";
import { config } from "./config.js";
import { processWhatsAppChange, type WhatsAppChangeValue } from "./whatsapp/process.js";
import type { WhatsAppSender } from "./whatsapp/send.js";

export const QUEUES = { whatsappInbound: "whatsapp.inbound" } as const;
export type Enqueue = (queue: string, data: { tenantId: string } & Record<string, unknown>) => Promise<string | null>;

// Job payloads always carry the tenant id; workers re-enter tenant context with withTenant() before touching data.
// The pgboss schema is job plumbing owned by its own role (app_queue) and is not exposed to tenants. Jobs are kept
// for a day after completion only, because inbound webhook payloads can contain student messages.
//
// `deps` lets tests inject a fake WhatsApp sender / LLM provider (mirrors chatRouter's llmProvider param and
// widgetRouter's ChallengeVerifier param) so the routing/idempotency/reply-sending logic is exercised for real,
// without a live WhatsApp Business account or spending real model quota.
export async function startQueue(deps: { sender?: WhatsAppSender; provider?: LlmProvider } = {}) {
  const boss = new PgBoss(config.DATABASE_URL_QUEUE);
  boss.on("error", (err) => console.error("queue error:", err.message));
  await boss.start();
  await boss.createQueue(QUEUES.whatsappInbound, { retryLimit: 3, retryBackoff: true, deleteAfterSeconds: 86_400 });

  await boss.work<{ tenantId: string; change?: WhatsAppChangeValue }>(QUEUES.whatsappInbound, async ([job]) => {
    if (!job) return;
    const value = job.data.change;
    if (!value || (!value.messages?.length && !value.statuses?.length)) return; // malformed/empty change: nothing to do
    await processWhatsAppChange(job.data.tenantId, value, deps);
  });

  const enqueue: Enqueue = (queue, data) => boss.send(queue, data);
  return { boss, enqueue, stop: () => boss.stop({ graceful: true, timeout: 10_000 }) };
}
