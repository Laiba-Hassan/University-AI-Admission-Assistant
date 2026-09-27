import { config } from "../config.js";

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

/** The one seam between "we decided to reply" and "Meta's Cloud API actually sent it" -- injectable exactly
 * like LlmProvider and ChallengeVerifier, so the queue worker's routing/splitting/idempotency logic is fully
 * testable without a real WhatsApp Business account. The default implementation is the real Graph API call. */
export interface WhatsAppSender {
  sendText(args: { phoneNumberId: string; accessToken: string; to: string; text: string }): Promise<SendResult>;
  sendTemplate(args: { phoneNumberId: string; accessToken: string; to: string; templateName: string; language: string }): Promise<SendResult>;
}

async function callGraphApi(phoneNumberId: string, accessToken: string, body: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch(`${config.WHATSAPP_GRAPH_BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !json.messages?.[0]) return { ok: false, error: json.error?.message ?? `graph_api_${res.status}` };
    return { ok: true, messageId: json.messages[0].id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
}

export const realWhatsAppSender: WhatsAppSender = {
  sendText: ({ phoneNumberId, accessToken, to, text }) =>
    callGraphApi(phoneNumberId, accessToken, { to, type: "text", text: { body: text, preview_url: false } }),
  // The one pre-approved utility template per tenant (PRD 6.2), used to reach a contact outside the 24-hour
  // free-form window. `language` is the template's configured locale code (e.g. "en", "ur"), not the student's --
  // template copy is fixed at approval time and cannot be composed per-reply.
  sendTemplate: ({ phoneNumberId, accessToken, to, templateName, language }) =>
    callGraphApi(phoneNumberId, accessToken, { to, type: "template", template: { name: templateName, language: { code: language } } }),
};

// WhatsApp text messages are capped at 4096 characters; long replies are split into short messages (PRD 6.2),
// breaking on paragraph/sentence boundaries where possible rather than mid-word.
const MAX_LEN = 4000; // a little under the real 4096 cap, leaving room for nothing surprising
export function splitForWhatsApp(text: string): string[] {
  if (text.length <= MAX_LEN) return [text];
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > MAX_LEN) {
    let cut = rest.lastIndexOf("\n\n", MAX_LEN);
    if (cut < MAX_LEN * 0.5) cut = rest.lastIndexOf(". ", MAX_LEN);
    if (cut < MAX_LEN * 0.5) cut = MAX_LEN;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
