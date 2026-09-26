import type { Tx } from "./db.js";

export interface ConversationFilters {
  channel?: "web" | "whatsapp";
  language?: string;
  status?: "open" | "needs_human" | "human" | "closed";
  hasLead?: boolean;
  thumbsDown?: boolean;
  search?: string;
  limit: number;
}

// A masked view of a WhatsApp number for the list, matching the reference's "+92 3●●-●●●●242" pattern; a web
// visitor has no phone number to mask, it's identified by its contact id instead.
const maskPhone = (external_id: string, channel: string) =>
  channel === "whatsapp" && external_id.length >= 6
    ? `${external_id.slice(0, 4)}${"●".repeat(Math.max(0, external_id.length - 7))}${external_id.slice(-3)}`
    : null;

export async function listConversations(tx: Tx, f: ConversationFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (f.channel) where.push(`c.channel = ${p(f.channel)}`);
  if (f.status) where.push(`c.status = ${p(f.status)}`);
  if (f.language) where.push(`lm.detected_language = ${p(f.language)}`);
  if (f.hasLead) where.push(`EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.contact_id)`);
  if (f.thumbsDown) where.push(`EXISTS (SELECT 1 FROM message_feedback mf JOIN messages m2 ON m2.id = mf.message_id WHERE m2.conversation_id = c.id AND mf.rating = -1)`);
  if (f.search) where.push(`(ct.external_id ILIKE ${p(`%${f.search}%`)} OR lm.content ILIKE ${p(`%${f.search}%`)})`);

  const sql = `
    SELECT c.id, c.tenant_id, c.channel, c.status, c.started_at, c.last_message_at, ct.external_id, ct.channel AS contact_channel,
      lm.content AS last_message, lm.detected_language AS language,
      EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.contact_id) AS has_lead,
      EXISTS (SELECT 1 FROM message_feedback mf JOIN messages m2 ON m2.id = mf.message_id WHERE m2.conversation_id = c.id AND mf.rating = -1) AS thumbs_down
    FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id
    LEFT JOIN LATERAL (
      SELECT content, detected_language FROM messages m WHERE m.conversation_id = c.id ORDER BY m."timestamp" DESC LIMIT 1
    ) lm ON true
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY c.last_message_at DESC
    LIMIT ${p(f.limit)}`;
  const rows = (await tx.query(sql, params)).rows as {
    id: string; tenant_id: string; channel: string; status: string; started_at: Date; last_message_at: Date;
    external_id: string; contact_channel: string; last_message: string | null; language: string | null;
    has_lead: boolean; thumbs_down: boolean;
  }[];
  // tenant_id is carried through even though RLS already makes cross-tenant rows unreachable: it's what the
  // generic isolation smoke test (test/isolation.test.ts) checks on every resource, and this route shares the
  // "conversations" name with that generic list, so dropping it would silently break that invariant check.
  return rows.map((r) => ({
    id: r.id, tenant_id: r.tenant_id, channel: r.channel, status: r.status, started_at: r.started_at, last_message_at: r.last_message_at,
    display_id: r.contact_channel === "whatsapp" ? maskPhone(r.external_id, r.contact_channel) : `Visitor #${r.external_id.slice(-4)}`,
    last_message: r.last_message, language: r.language, has_lead: r.has_lead, thumbs_down: r.thumbs_down,
  }));
}

export async function getConversationDetail(tx: Tx, id: string) {
  const conv = (await tx.query(
    `SELECT c.id, c.channel, c.status, c.started_at, c.last_message_at, ct.external_id, ct.channel AS contact_channel
     FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = $1`, [id])).rows[0] as
    { id: string; channel: string; status: string; started_at: Date; last_message_at: Date; external_id: string; contact_channel: string } | undefined;
  if (!conv) return null;

  const messages = (await tx.query(
    `SELECT m.id, m.role, m.content, m.detected_language, m."timestamp", m.metadata, mf.rating
     FROM messages m LEFT JOIN message_feedback mf ON mf.message_id = m.id
     WHERE m.conversation_id = $1 ORDER BY m."timestamp" ASC`, [id])).rows;

  return {
    id: conv.id, channel: conv.channel, status: conv.status, started_at: conv.started_at, last_message_at: conv.last_message_at,
    display_id: conv.contact_channel === "whatsapp" ? maskPhone(conv.external_id, conv.contact_channel) : `Visitor #${conv.external_id.slice(-4)}`,
    messages,
  };
}

export async function escalateConversation(tx: Tx, id: string, reason: string) {
  const updated = await tx.query(`UPDATE conversations SET status = 'needs_human', last_message_at = now() WHERE id = $1 AND status <> 'needs_human' RETURNING id`, [id]);
  if (updated.rowCount) {
    await tx.query(`INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'handoff_requested', $1)`,
      [JSON.stringify({ conversation_id: id, reason })]);
  }
  return { escalated: !!updated.rowCount };
}

/** "Assign to me": self-assignment only (a staff member claiming a conversation), never assigning someone else. */
export async function assignConversationToSelf(tx: Tx, id: string, authUserId: string) {
  const staffRow = (await tx.query(`SELECT id FROM tenant_users WHERE auth_user_id = $1`, [authUserId])).rows[0] as { id: string } | undefined;
  if (!staffRow) return { assigned: false };
  const updated = await tx.query(`UPDATE conversations SET assigned_to = $1 WHERE id = $2 RETURNING id`, [staffRow.id, id]);
  return { assigned: !!updated.rowCount };
}

/** Staff sends a reply directly (Inbox). Recorded as a real message and moves the conversation into 'human'
 * (staff actively handling); actually delivering it back over WhatsApp/the widget in real time is a separate
 * channel-delivery concern (Meta send API / widget push) not built yet -- this only makes the reply exist. */
export async function sendStaffReply(tx: Tx, id: string, text: string) {
  const conv = await tx.query(`SELECT id FROM conversations WHERE id = $1`, [id]);
  if (!conv.rowCount) return null;
  const msg = (await tx.query(
    `INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES (current_tenant_id(), $1, 'staff', $2) RETURNING id, "timestamp"`,
    [id, text])).rows[0] as { id: string; timestamp: Date };
  await tx.query(`UPDATE conversations SET status = 'human', last_message_at = now() WHERE id = $1`, [id]);
  return msg;
}

export async function setConversationStatus(tx: Tx, id: string, status: "open" | "closed") {
  const updated = await tx.query(`UPDATE conversations SET status = $1, last_message_at = now() WHERE id = $2 RETURNING id`, [status, id]);
  return { updated: !!updated.rowCount };
}
