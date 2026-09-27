import { handleMessage } from "../agent/conversation.js";
import type { LlmProvider } from "../agent/llm.js";
import { withTenant } from "../db.js";
import { realWhatsAppSender, splitForWhatsApp, type WhatsAppSender } from "./send.js";
import { getWhatsAppConnection } from "./connection.js";

// Meta's webhook payload shape for one `entry[].changes[].value`. Only the fields this project actually reads.
export interface WhatsAppChangeValue {
  metadata?: { phone_number_id?: string };
  messages?: { id: string; from: string; timestamp?: string; type: string; text?: { body: string } }[];
  statuses?: { id: string; status: string; recipient_id?: string }[];
}

const OPT_OUT_PHRASES = new Set(["stop", "unsubscribe", "cancel", "opt out", "optout", "quit", "band karo", "rok do"]);

const UNSUPPORTED_MEDIA_FALLBACK: Record<string, string> = {
  english: "Sorry, I can only read text messages right now. Please type your question and I'll help.",
  roman_urdu: "Maazrat, abhi mein sirf text messages parh sakta hoon. Apna sawal likh kar bhejein.",
  urdu: "معذرت، میں فی الحال صرف تحریری پیغامات پڑھ سکتا ہوں۔ براہ کرم اپنا سوال لکھ کر بھیجیں۔",
};

/** One inbound webhook `change.value`, fully processed: delivery-status callbacks applied, opted-out contacts
 * silenced, unsupported media answered with a fixed fallback, and real text messages routed through the exact
 * same handleMessage() core the web widget uses -- then the reply (split if long) sent back over WhatsApp.
 * Idempotency on Meta's message id comes from handleMessage's own ON CONFLICT DO NOTHING insert; a replayed
 * webhook reaches here and simply produces no reply the second time. */
export async function processWhatsAppChange(
  tenantId: string, value: WhatsAppChangeValue,
  deps: { sender?: WhatsAppSender; provider?: LlmProvider } = {},
): Promise<void> {
  const sender = deps.sender ?? realWhatsAppSender;

  for (const status of value.statuses ?? []) {
    await withTenant(tenantId, (tx) =>
      tx.query(`UPDATE messages SET delivery_status = $1 WHERE channel_message_id = $2`, [status.status, status.id]));
  }

  const connection = await withTenant(tenantId, getWhatsAppConnection);

  for (const msg of value.messages ?? []) {
    if (msg.type === "text" && OPT_OUT_PHRASES.has(msg.text!.body.trim().toLowerCase())) {
      // Upsert: this may be the contact's very first message ever, so there's no existing row to UPDATE yet.
      await withTenant(tenantId, (tx) => tx.query(
        `INSERT INTO contacts (tenant_id, channel, external_id, opted_out) VALUES (current_tenant_id(), 'whatsapp', $1, true)
         ON CONFLICT (tenant_id, channel, external_id) DO UPDATE SET opted_out = true`, [msg.from]));
      continue; // PRD 6.2: opting out ends business-initiated messages -- no reply sent, including this turn
    }

    if (msg.type !== "text") {
      if (!connection) continue;
      const language = await withTenant(tenantId, async (tx) =>
        (await tx.query(`SELECT default_reply_script FROM tenants`)).rows[0]?.default_reply_script as string ?? "english");
      await sendReply(sender, connection, msg.from, UNSUPPORTED_MEDIA_FALLBACK[language] ?? UNSUPPORTED_MEDIA_FALLBACK.english!);
      continue;
    }

    const out = await handleMessage({
      tenantId, channel: "whatsapp", externalId: msg.from, text: msg.text!.body,
      channelMessageId: msg.id, provider: deps.provider,
    });
    if (!out.reply || !connection) continue;

    const sentIds = await sendReply(sender, connection, msg.from, out.reply);
    // Tag the assistant message we just stored with the outbound WhatsApp message id, so a later delivery-status
    // callback (sent/delivered/read/failed) can find it via the same channel_message_id lookup used for inbound
    // replay protection. Only the first split part is tracked -- delivery status is inherently per-message on
    // Meta's side, and the reference implementation doesn't need per-part granularity.
    if (out.messageId && sentIds[0]) {
      await withTenant(tenantId, (tx) => tx.query(`UPDATE messages SET channel_message_id = $1 WHERE id = $2`, [sentIds[0], out.messageId]));
    }
  }
}

async function sendReply(sender: WhatsAppSender, connection: NonNullable<Awaited<ReturnType<typeof getWhatsAppConnection>>>, to: string, text: string): Promise<string[]> {
  const ids: string[] = [];
  for (const part of splitForWhatsApp(text)) {
    const result = await sender.sendText({ phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken, to, text: part });
    if (result.ok) ids.push(result.messageId);
    else console.error("whatsapp send failed:", result.error);
  }
  return ids;
}
