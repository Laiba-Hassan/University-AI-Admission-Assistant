import { randomBytes } from "node:crypto";
import type { Tx } from "./db.js";

export async function getUsageSummary(tx: Tx) {
  const limits = (await tx.query(`SELECT monthly_conversation_limit, monthly_message_limit, web_enabled, whatsapp_enabled FROM tenant_limits`)).rows[0] as
    { monthly_conversation_limit: number; monthly_message_limit: number; web_enabled: boolean; whatsapp_enabled: boolean } | undefined;
  // Same counting query the live limit-enforcement path uses (agent/conversation.ts), so what Settings shows the
  // tenant matches what actually blocks them, never a separately-computed (and possibly diverging) estimate.
  const conversations = (await tx.query(`SELECT count(*)::int AS n FROM usage_events WHERE event_type = 'conversation_started' AND "timestamp" >= date_trunc('month', now())`)).rows[0].n as number;
  const messages = (await tx.query(`SELECT count(*)::int AS n FROM usage_events WHERE event_type = 'message_received' AND "timestamp" >= date_trunc('month', now())`)).rows[0].n as number;
  // Per-channel breakdown (Settings > Usage shows Web and WhatsApp side by side): the same two event types,
  // grouped by the `channel` column usage_events already carries, against the one shared monthly limit above.
  const byChannel = (await tx.query(
    `SELECT channel, event_type, count(*)::int AS n FROM usage_events
      WHERE event_type IN ('conversation_started', 'message_received') AND "timestamp" >= date_trunc('month', now())
      GROUP BY channel, event_type`)).rows as { channel: string | null; event_type: string; n: number }[];
  const forChannel = (channel: string, eventType: string) => byChannel.find((r) => r.channel === channel && r.event_type === eventType)?.n ?? 0;
  return {
    monthly_conversation_limit: limits?.monthly_conversation_limit ?? 0,
    monthly_message_limit: limits?.monthly_message_limit ?? 0,
    web_enabled: limits?.web_enabled ?? false,
    whatsapp_enabled: limits?.whatsapp_enabled ?? false,
    conversations_used: conversations,
    messages_used: messages,
    by_channel: {
      web: { conversations: forChannel("web", "conversation_started"), messages: forChannel("web", "message_received") },
      whatsapp: { conversations: forChannel("whatsapp", "conversation_started"), messages: forChannel("whatsapp", "message_received") },
    },
  };
}

export async function getChannels(tx: Tx) {
  const rows = (await tx.query(
    `SELECT channel, phone_number_id, display_number, template_status, status, connected_at FROM channel_connections`)).rows;
  const widget = (await tx.query(`SELECT public_key, allowed_origins, status FROM widget_keys ORDER BY id LIMIT 1`)).rows[0];
  return { web_widget: widget ?? null, whatsapp: rows.find((r) => r.channel === "whatsapp") ?? null };
}

/** A tenant only ever needs one active web widget key (the loader script embeds exactly one). Creating one for
 * a tenant that already has one is a no-op rather than a second key, since the widget only ever expects to
 * reference the tenant's single public_key from Settings -- rotating is a separate, explicit action. */
export async function ensureWidgetKey(tx: Tx, allowedOrigins: string[]) {
  const existing = (await tx.query(`SELECT public_key, allowed_origins FROM widget_keys ORDER BY id LIMIT 1`)).rows[0] as
    { public_key: string; allowed_origins: string[] } | undefined;
  if (existing) return existing;
  const publicKey = `wk_${randomBytes(16).toString("hex")}`;
  await tx.query(`INSERT INTO widget_keys (tenant_id, public_key, allowed_origins) VALUES (current_tenant_id(), $1, $2)`, [publicKey, allowedOrigins]);
  return { public_key: publicKey, allowed_origins: allowedOrigins };
}

export async function setWidgetOrigins(tx: Tx, allowedOrigins: string[]) {
  await tx.query(`UPDATE widget_keys SET allowed_origins = $1`, [allowedOrigins]);
}

/** A genuinely new key (invalidates the old one): for a tenant that suspects its key leaked, not part of normal
 * setup. The widget itself must be re-embedded with the new key afterward. */
export async function rotateWidgetKey(tx: Tx) {
  const publicKey = `wk_${randomBytes(16).toString("hex")}`;
  await tx.query(`UPDATE widget_keys SET public_key = $1`, [publicKey]);
  return publicKey;
}

export async function getBranding(tx: Tx) {
  return (await tx.query(`SELECT name, branding, working_hours FROM tenants`)).rows[0];
}

export async function updateBranding(tx: Tx, patch: { branding?: Record<string, unknown>; working_hours?: Record<string, unknown> }) {
  if (patch.branding) await tx.query(`UPDATE tenants SET branding = branding || $1::jsonb`, [JSON.stringify(patch.branding)]);
  if (patch.working_hours) await tx.query(`UPDATE tenants SET working_hours = $1::jsonb`, [JSON.stringify(patch.working_hours)]);
}

export async function getTeam(tx: Tx) {
  return (await tx.query(`SELECT id, email, role, notify_leads, notify_handoffs FROM tenant_users ORDER BY email`)).rows;
}

export async function inviteStaff(tx: Tx, email: string, role: "admin" | "editor" | "viewer", tokenHash: string, invitedByAuthUserId: string) {
  const inviter = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [invitedByAuthUserId])).rows[0] as { id: string } | undefined;
  await tx.query(
    `INSERT INTO staff_invites (tenant_id, email, role, token_hash, expires_at, invited_by) VALUES (current_tenant_id(), $1, $2, $3, now() + interval '7 days', $4)`,
    [email, role, tokenHash, inviter?.id ?? null]);
}

export async function getMessages(tx: Tx) {
  return (await tx.query(`SELECT key, language, text FROM localized_messages ORDER BY key, language`)).rows;
}
export async function setMessage(tx: Tx, key: string, language: string, text: string) {
  await tx.query(`UPDATE localized_messages SET text = $1 WHERE key = $2 AND language = $3`, [text, key, language]);
}

export async function getRetention(tx: Tx) {
  return (await tx.query(`SELECT retention_days FROM tenants`)).rows[0] as { retention_days: number };
}
export async function setRetention(tx: Tx, days: number) {
  await tx.query(`UPDATE tenants SET retention_days = $1`, [days]);
}
