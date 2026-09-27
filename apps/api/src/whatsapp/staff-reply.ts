import type { Tx } from "../db.js";
import { getWhatsAppConnection } from "./connection.js";
import { realWhatsAppSender, splitForWhatsApp, type WhatsAppSender } from "./send.js";

export type DeliveryMode = "free_form" | "template" | "blocked";

/** PRD 6.2/6.3: a staff reply can go out as free text only within 24 hours of the student's last message; after
 * that, only the tenant's one pre-approved utility template can reach them (and that template's own fixed copy
 * is sent -- the staff member's actual text is NOT what gets delivered, it stays as internal dashboard context
 * until the student replies and free-form opens again). Pure and separately unit-tested since it's the one
 * genuinely tricky decision in this whole path. */
export function decideDeliveryMode(hoursSinceLastInbound: number | null, hasTemplate: boolean): DeliveryMode {
  if (hoursSinceLastInbound !== null && hoursSinceLastInbound < 24) return "free_form";
  return hasTemplate ? "template" : "blocked";
}

export interface StaffReplyDelivery { delivered: boolean; mode?: DeliveryMode; reason?: string }

/** Called after sendStaffReply() has already stored the message: if the conversation is a WhatsApp one with an
 * active connection, actually deliver it (or the re-engagement template) over the Graph API. A web conversation,
 * or a WhatsApp one with no connection configured, is a no-op -- the reply already exists for the dashboard
 * either way, this only concerns whether the student's phone also gets it. */
export async function deliverStaffReplyOverWhatsApp(tx: Tx, conversationId: string, text: string, sender: WhatsAppSender = realWhatsAppSender): Promise<StaffReplyDelivery> {
  const conv = (await tx.query(
    `SELECT c.channel, ct.external_id,
            (SELECT max(m."timestamp") FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_inbound_at
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = $1`, [conversationId]
  )).rows[0] as { channel: string; external_id: string; last_inbound_at: Date | null } | undefined;
  if (!conv || conv.channel !== "whatsapp") return { delivered: false, reason: "not_whatsapp" };

  const connection = await getWhatsAppConnection(tx);
  if (!connection) return { delivered: false, reason: "no_connection" };

  const hours = conv.last_inbound_at ? (Date.now() - conv.last_inbound_at.getTime()) / 3_600_000 : null;
  const mode = decideDeliveryMode(hours, Boolean(connection.templateName));
  if (mode === "blocked") return { delivered: false, reason: "window_closed_no_template" };

  if (mode === "template") {
    const result = await sender.sendTemplate({ phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken, to: conv.external_id, templateName: connection.templateName!, language: "en" });
    return result.ok ? { delivered: true, mode } : { delivered: false, reason: result.error };
  }
  for (const part of splitForWhatsApp(text)) {
    const result = await sender.sendText({ phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken, to: conv.external_id, text: part });
    if (!result.ok) return { delivered: false, reason: result.error };
  }
  return { delivered: true, mode };
}
