import { withoutTenant, withTenant, type Tx } from "./db.js";

// Phase 7: n8n-style automations. The app never talks to n8n/Zapier/etc directly -- it just POSTs every
// event_outbox event, as JSON, to whatever URL the tenant configures here. What happens with it (send an email,
// log a lead to a spreadsheet, page someone) is entirely the tenant's own webhook/workflow, not this codebase's
// concern -- same "PRD leaves the actual workflow tool external" reasoning as the desktop app's install docs.

export interface AutomationSettings { webhook_url: string | null; enabled: boolean }

export async function getAutomationSettings(tx: Tx): Promise<AutomationSettings> {
  const row = (await tx.query(`SELECT webhook_url, enabled FROM automation_settings`)).rows[0] as AutomationSettings | undefined;
  return row ?? { webhook_url: null, enabled: true };
}

export async function setAutomationSettings(tx: Tx, patch: { webhook_url?: string | null; enabled?: boolean }) {
  // webhook_url is nullable -- undefined ("field not sent") must leave it untouched, while an explicit null
  // ("clear it") must actually clear it, so this can't use a single COALESCE($1, existing) the way updateBranding
  // does for its always-present fields.
  const current = await getAutomationSettings(tx);
  const webhookUrl = "webhook_url" in patch ? patch.webhook_url ?? null : current.webhook_url;
  const enabled = patch.enabled ?? current.enabled;
  await tx.query(
    `INSERT INTO automation_settings (tenant_id, webhook_url, enabled) VALUES (current_tenant_id(), $1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET webhook_url = $1, enabled = $2, updated_at = now()`,
    [webhookUrl, enabled]);
}

export type WebhookSendFn = (url: string, body: string) => Promise<{ ok: boolean; status: number }>;

const defaultSend: WebhookSendFn = async (url, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
};

interface ClaimedEvent { out_event_id: string; out_tenant_id: string; out_event_type: string; out_payload: unknown; out_created_at: string }

/** Drains event_outbox (every event type, every tenant -- claim_automation_events.sql is the one place allowed
 * to see them all at once) and POSTs each one to that tenant's configured webhook, if any. Best-effort, single
 * attempt: a down/misconfigured endpoint is logged and skipped, same philosophy as sendPushToTenant, rather than
 * building a retry queue for what is meant to be a thin, optional integration point. */
export async function processPendingAutomationEvents(send: WebhookSendFn = defaultSend, limit = 50) {
  const events = await withoutTenant(async (tx) =>
    (await tx.query(`SELECT out_event_id, out_tenant_id, out_event_type, out_payload, out_created_at FROM claim_automation_events($1)`, [limit])).rows
  ) as ClaimedEvent[];
  let delivered = 0;
  for (const event of events) {
    const settings = await withTenant(event.out_tenant_id, getAutomationSettings);
    if (!settings.enabled || !settings.webhook_url) continue;
    try {
      const res = await send(settings.webhook_url, JSON.stringify({
        event_type: event.out_event_type, payload: event.out_payload, created_at: event.out_created_at, tenant_id: event.out_tenant_id,
      }));
      if (res.ok) delivered++;
      else console.error(`automation webhook non-2xx (${res.status}) for tenant ${event.out_tenant_id}, event ${event.out_event_type}`);
    } catch (err) {
      console.error("automation webhook delivery failed:", err instanceof Error ? err.message : err);
    }
  }
  return { delivered, claimed: events.length };
}

/** "Send test event" button in Settings > Automations: an immediate, synchronous POST (not queued through
 * event_outbox) so the staff member gets a pass/fail right in the UI instead of waiting for the next poll. */
export async function sendTestAutomationEvent(tx: Tx, send: WebhookSendFn = defaultSend): Promise<{ ok: boolean }> {
  const settings = await getAutomationSettings(tx);
  if (!settings.webhook_url) return { ok: false };
  try {
    const res = await send(settings.webhook_url, JSON.stringify({ event_type: "test", payload: { message: "This is a test event from your admissions assistant." }, created_at: new Date().toISOString() }));
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/** Fires at most once per tenant per calendar month per limit type (checked inside the same transaction as the
 * block itself, so it can never race with a second blocked request seconds later). Called from the exact two
 * block points in agent/conversation.ts. */
export async function maybeEmitLimitWarning(tx: Tx, limitType: "monthly_conversation" | "monthly_message") {
  await tx.query(
    `INSERT INTO event_outbox (tenant_id, event_type, payload)
     SELECT current_tenant_id(), 'limit_warning', $1::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM event_outbox
        WHERE tenant_id = current_tenant_id() AND event_type = 'limit_warning'
          AND payload->>'limit_type' = $2 AND created_at >= date_trunc('month', now())
     )`,
    [JSON.stringify({ limit_type: limitType }), limitType]);
}

/** PRD 6A/7: "daily usage report". Iterates every active tenant (platform_list_tenants(), the same cross-tenant
 * read the Super Admin Tenants page uses) and stages one event per tenant with the last 24h of usage -- guarded
 * by the same NOT EXISTS-today dedup as limit warnings, so calling this more than once a day (a plain interval,
 * not a real cron) is harmless. Meant to be run once a day from server.ts. */
export async function generateDailyUsageReports() {
  const tenants = await withoutTenant(async (tx) => (await tx.query(`SELECT id, status FROM platform_list_tenants()`)).rows) as { id: string; status: string }[];
  let created = 0;
  for (const t of tenants) {
    if (t.status !== "active") continue;
    await withTenant(t.id, async (tx) => {
      const usage = (await tx.query(
        `SELECT
           count(*) FILTER (WHERE event_type = 'conversation_started')::int AS conversations,
           count(*) FILTER (WHERE event_type = 'message_received')::int AS messages,
           count(*) FILTER (WHERE event_type = 'lead_created')::int AS leads,
           count(*) FILTER (WHERE event_type = 'handoff_requested')::int AS handoffs
         FROM usage_events WHERE "timestamp" >= now() - interval '24 hours'`)).rows[0];
      const inserted = await tx.query(
        `INSERT INTO event_outbox (tenant_id, event_type, payload)
         SELECT current_tenant_id(), 'daily_usage_report', $1::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM event_outbox
            WHERE tenant_id = current_tenant_id() AND event_type = 'daily_usage_report'
              AND created_at >= date_trunc('day', now())
         ) RETURNING id`,
        [JSON.stringify({ ...usage, since: new Date(Date.now() - 86_400_000).toISOString() })]);
      if (inserted.rowCount) created++;
    });
  }
  return { created };
}
