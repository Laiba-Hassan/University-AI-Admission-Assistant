import { handleMessage } from "../agent/conversation.js";
import type { LlmProvider } from "../agent/llm.js";
import { withTenant, type Tx } from "../db.js";
import type { SttProvider } from "../voice/transcribe.js";
import { processVoiceMessage, vocabularyHints as vocabularyHintsForTx } from "../voice/pipeline.js";
import { downloadWhatsAppMedia } from "../voice/whatsapp-media.js";
import { realWhatsAppSender, splitForWhatsApp, type WhatsAppSender } from "./send.js";
import { getWhatsAppConnection, type WhatsAppConnection } from "./connection.js";

// Meta's webhook payload shape for one `entry[].changes[].value`. Only the fields this project actually reads.
export interface WhatsAppChangeValue {
  metadata?: { phone_number_id?: string };
  messages?: { id: string; from: string; timestamp?: string; type: string; text?: { body: string }; audio?: { id: string; mime_type: string } }[];
  statuses?: { id: string; status: string; recipient_id?: string }[];
}

const OPT_OUT_PHRASES = new Set(["stop", "unsubscribe", "cancel", "opt out", "optout", "quit", "band karo", "rok do"]);

const UNSUPPORTED_MEDIA_FALLBACK: Record<string, string> = {
  english: "Sorry, I can only read text messages right now. Please type your question and I'll help.",
  roman_urdu: "Maazrat, abhi mein sirf text messages parh sakta hoon. Apna sawal likh kar bhejein.",
  urdu: "معذرت، میں فی الحال صرف تحریری پیغامات پڑھ سکتا ہوں۔ براہ کرم اپنا سوال لکھ کر بھیجیں۔",
};
// PRD 6.2: "silent, too-short, unintelligible, or low-confidence audio gets a polite 'please resend or type'
// reply" -- one shared message for all four reasons, matching the PRD's own generalization.
const VOICE_RETRY_FALLBACK: Record<string, string> = {
  english: "Sorry, I couldn't quite make that out. Could you resend your voice message, or type your question instead?",
  roman_urdu: "Maazrat, mujhe woh sunai nahi diya. Dobara voice message bhejein ya apna sawal type kar dein.",
  urdu: "معذرت، مجھے وہ سنائی نہیں دیا۔ براہ کرم دوبارہ وائس میسج بھیجیں یا اپنا سوال لکھ دیں۔",
};

async function defaultLanguage(tenantId: string): Promise<string> {
  return withTenant(tenantId, async (tx) => (await tx.query(`SELECT default_reply_script FROM tenants`)).rows[0]?.default_reply_script as string ?? "english");
}
const vocabularyHints = (tenantId: string) => withTenant(tenantId, vocabularyHintsForTx);

/** One inbound webhook `change.value`, fully processed: delivery-status callbacks applied, opted-out contacts
 * silenced, voice notes transcribed through the shared voice pipeline (PRD 6B), other unsupported media answered
 * with a fixed fallback, and real text messages routed through the exact same handleMessage() core the web
 * widget uses -- then the reply (split if long) sent back over WhatsApp. Idempotency on Meta's message id comes
 * from handleMessage's own ON CONFLICT DO NOTHING insert; a replayed webhook reaches here and simply produces no
 * reply the second time (voice notes are idempotent the same way, via the same channelMessageId). */
export async function processWhatsAppChange(
  tenantId: string, value: WhatsAppChangeValue,
  deps: { sender?: WhatsAppSender; provider?: LlmProvider; stt?: SttProvider; downloadMedia?: typeof downloadWhatsAppMedia } = {},
): Promise<void> {
  const sender = deps.sender ?? realWhatsAppSender;
  const downloadMedia = deps.downloadMedia ?? downloadWhatsAppMedia;

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

    if (msg.type === "audio") {
      if (!connection) continue;
      await handleWhatsAppVoiceNote(tenantId, msg, connection, sender, { ...deps, downloadMedia });
      continue;
    }

    if (msg.type !== "text") {
      if (!connection) continue;
      await sendReply(sender, connection, msg.from, UNSUPPORTED_MEDIA_FALLBACK[await defaultLanguage(tenantId)] ?? UNSUPPORTED_MEDIA_FALLBACK.english!);
      continue;
    }

    const out = await handleMessage({
      tenantId, channel: "whatsapp", externalId: msg.from, text: msg.text!.body,
      channelMessageId: msg.id, provider: deps.provider,
    });
    await deliverAndTagReply(tenantId, sender, connection, msg.from, out.reply, out.messageId);
  }
}

async function handleWhatsAppVoiceNote(
  tenantId: string, msg: { id: string; from: string; audio?: { id: string; mime_type: string } }, connection: WhatsAppConnection,
  sender: WhatsAppSender, deps: { provider?: LlmProvider; stt?: SttProvider; downloadMedia: typeof downloadWhatsAppMedia },
) {
  // A retried webhook delivery (Meta retries on anything but a fast 200) would otherwise download and transcribe
  // the same audio again just to have handleMessage() discover it's a duplicate afterwards -- both wasted work
  // and a wasted STT call. handleMessage still does its own ON CONFLICT DO NOTHING regardless; this just avoids
  // paying for a transcription whose result can never be stored.
  const already = await withTenant(tenantId, (tx) => tx.query(`SELECT 1 FROM messages WHERE channel_message_id = $1`, [msg.id]));
  if (already.rowCount) return;

  const media = msg.audio && await deps.downloadMedia(msg.audio.id, connection.accessToken);
  if (!media) {
    await sendReply(sender, connection, msg.from, VOICE_RETRY_FALLBACK[await defaultLanguage(tenantId)] ?? VOICE_RETRY_FALLBACK.english!);
    return;
  }
  const hints = await vocabularyHints(tenantId);
  const result = await processVoiceMessage(media.buffer, msg.audio!.mime_type, hints, { stt: deps.stt });
  if (!result.ok) {
    await sendReply(sender, connection, msg.from, VOICE_RETRY_FALLBACK[await defaultLanguage(tenantId)] ?? VOICE_RETRY_FALLBACK.english!);
    return;
  }
  const out = await handleMessage({
    tenantId, channel: "whatsapp", externalId: msg.from, text: result.transcript,
    channelMessageId: msg.id, provider: deps.provider,
    contentType: "voice", audioSeconds: result.audioSeconds, forcedLanguage: result.language ?? undefined,
  });
  await deliverAndTagReply(tenantId, sender, connection, msg.from, out.reply, out.messageId);
}

async function deliverAndTagReply(tenantId: string, sender: WhatsAppSender, connection: WhatsAppConnection | null, to: string, reply: string, messageId: string | null) {
  if (!reply || !connection) return;
  const sentIds = await sendReply(sender, connection, to, reply);
  // Tag the assistant message we just stored with the outbound WhatsApp message id, so a later delivery-status
  // callback (sent/delivered/read/failed) can find it via the same channel_message_id lookup used for inbound
  // replay protection. Only the first split part is tracked -- delivery status is inherently per-message on
  // Meta's side, and the reference implementation doesn't need per-part granularity.
  if (messageId && sentIds[0]) {
    await withTenant(tenantId, (tx: Tx) => tx.query(`UPDATE messages SET channel_message_id = $1 WHERE id = $2`, [sentIds[0], messageId]));
  }
}

async function sendReply(sender: WhatsAppSender, connection: WhatsAppConnection, to: string, text: string): Promise<string[]> {
  const ids: string[] = [];
  for (const part of splitForWhatsApp(text)) {
    const result = await sender.sendText({ phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken, to, text: part });
    if (result.ok) ids.push(result.messageId);
    else console.error("whatsapp send failed:", result.error);
  }
  return ids;
}
