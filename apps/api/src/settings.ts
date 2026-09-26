import type { Tx } from "./db.js";

export async function getUsageSummary(tx: Tx) {
  const limits = (await tx.query(`SELECT monthly_conversation_limit, monthly_message_limit, web_enabled, whatsapp_enabled FROM tenant_limits`)).rows[0] as
    { monthly_conversation_limit: number; monthly_message_limit: number; web_enabled: boolean; whatsapp_enabled: boolean } | undefined;
  // Same counting query the live limit-enforcement path uses (agent/conversation.ts), so what Settings shows the
  // tenant matches what actually blocks them, never a separately-computed (and possibly diverging) estimate.
  const conversations = (await tx.query(`SELECT count(*)::int AS n FROM usage_events WHERE event_type = 'conversation_started' AND "timestamp" >= date_trunc('month', now())`)).rows[0].n as number;
  const messages = (await tx.query(`SELECT count(*)::int AS n FROM usage_events WHERE event_type = 'message_received' AND "timestamp" >= date_trunc('month', now())`)).rows[0].n as number;
  return {
    monthly_conversation_limit: limits?.monthly_conversation_limit ?? 0,
    monthly_message_limit: limits?.monthly_message_limit ?? 0,
    web_enabled: limits?.web_enabled ?? false,
    whatsapp_enabled: limits?.whatsapp_enabled ?? false,
    conversations_used: conversations,
    messages_used: messages,
  };
}

export async function getChannels(tx: Tx) {
  const rows = (await tx.query(
    `SELECT channel, phone_number_id, display_number, template_status, status, connected_at FROM channel_connections`)).rows;
  const widget = (await tx.query(`SELECT public_key, allowed_origins, status FROM widget_keys ORDER BY id LIMIT 1`)).rows[0];
  return { web_widget: widget ?? null, whatsapp: rows.find((r) => r.channel === "whatsapp") ?? null };
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
