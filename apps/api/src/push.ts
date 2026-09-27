import webpush from "web-push";
import { withoutTenant, withTenant, type Tx } from "./db.js";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

export const vapidConfigured = Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
if (vapidConfigured) webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);

export interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string } }

/** Settings' desktop-notifications opt-in (PRD 6A: "opt-in in Settings, push_subscriptions under RLS"). `keys`
 * is encrypted before storage per the schema's own comment ("encrypted at the application layer"). */
export async function savePushSubscription(tx: Tx, tenantUserId: string, sub: PushSubscriptionInput) {
  await tx.query(
    `INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, keys) VALUES (current_tenant_id(), $1, $2, $3)
     ON CONFLICT (tenant_id, endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys, last_used_at = NULL`,
    [tenantUserId, sub.endpoint, encryptSecret(JSON.stringify(sub.keys))]);
}

export async function deletePushSubscription(tx: Tx, endpoint: string) {
  await tx.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export type PushSendFn = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

/** A minimal alert -- title and a generic body, never the student's name or phone number (PRD 6A), with a URL
 * to open on click. Best-effort per subscription: an expired/unsubscribed endpoint (410 Gone / 404) is removed
 * so the next event doesn't keep retrying it forever; any other failure is just logged. `send` is injectable
 * (defaults to the real web-push call) so this is testable without a live push service. */
export async function sendPushToTenant(tx: Tx, payload: { title: string; body: string; url: string }, send: PushSendFn = webpush.sendNotification.bind(webpush) as PushSendFn) {
  const subs = (await tx.query(`SELECT id, endpoint, keys FROM push_subscriptions`)).rows as { id: string; endpoint: string; keys: string }[];
  let sent = 0;
  for (const sub of subs) {
    try {
      const keys = JSON.parse(decryptSecret(sub.keys)) as { p256dh: string; auth: string };
      await send({ endpoint: sub.endpoint, keys }, JSON.stringify(payload));
      await tx.query(`UPDATE push_subscriptions SET last_used_at = now() WHERE id = $1`, [sub.id]);
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await tx.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
      else console.error("push send failed:", err instanceof Error ? err.message : err);
    }
  }
  return { sent };
}

const ALERT_COPY: Record<string, { title: string; body: string; path: string }> = {
  lead_created: { title: "New lead captured", body: "A student left their contact details.", path: "/leads" },
  handoff_requested: { title: "A student needs a person", body: "A conversation is waiting for a staff reply.", path: "/inbox" },
};

/** The queue worker PRD 6A describes: drains event_outbox's pending lead/handoff events (across every tenant --
 * claim_push_events.sql is the one place allowed to see them all at once) and pushes an alert to each tenant's
 * subscribed devices. Called on an interval from server.ts, same 5s-poll spirit as the dashboard's own alerts. */
export async function processPendingPushEvents(send?: PushSendFn) {
  // The real default sender needs real VAPID keys; an explicitly-injected one (tests) doesn't, so only the
  // no-argument (production) call is gated on vapidConfigured.
  if (!send && !vapidConfigured) return;
  const events = await withoutTenant(async (tx) => (await tx.query(`SELECT out_event_id, out_tenant_id, out_event_type, out_payload FROM claim_push_events($1)`, [50])).rows) as
    { out_event_id: string; out_tenant_id: string; out_event_type: string; out_payload: { conversation_id?: string; lead_id?: string } }[];
  for (const event of events) {
    const copy = ALERT_COPY[event.out_event_type];
    if (!copy) continue;
    const url = event.out_event_type === "handoff_requested" && event.out_payload.conversation_id ? "/inbox" : copy.path;
    await withTenant(event.out_tenant_id, (tx2) => sendPushToTenant(tx2, { title: copy.title, body: copy.body, url }, send));
  }
}
