import type { Tx } from "../db.js";
import { decryptSecret, encryptSecret, maskSecret } from "../secrets.js";

export interface WhatsAppConnection {
  phoneNumberId: string; wabaId: string | null; displayNumber: string | null; accessToken: string;
  templateName: string | null; templateStatus: string | null; status: string;
}

/** The tenant's active WhatsApp connection, token decrypted -- for actually calling the Send API. Never exposed
 * to the dashboard; that only ever sees getChannelsForSettings() below (masked, no token). */
export async function getWhatsAppConnection(tx: Tx): Promise<WhatsAppConnection | null> {
  const row = (await tx.query(
    `SELECT phone_number_id, waba_id, display_number, token_secret_ref, template_status, status
       FROM channel_connections WHERE channel = 'whatsapp' LIMIT 1`)).rows[0] as
    { phone_number_id: string | null; waba_id: string | null; display_number: string | null; token_secret_ref: string | null; template_status: string | null; status: string } | undefined;
  if (!row?.phone_number_id || !row.token_secret_ref || row.status !== "active") return null;
  const [templateName] = (row.template_status ?? "").split(":"); // stored as "templateName:approved" -- see saveWhatsAppConnection
  return {
    phoneNumberId: row.phone_number_id, wabaId: row.waba_id, displayNumber: row.display_number,
    accessToken: decryptSecret(row.token_secret_ref), templateName: templateName || null,
    templateStatus: row.template_status, status: row.status,
  };
}

/** Settings > Channels' "guided manual connection" (PRD 6.2's fallback to Embedded Signup, which needs Meta
 * Tech Provider approval this project doesn't have): a staff admin pastes in the phone number id, WABA id and a
 * permanent access token from their own Meta Business/App dashboard. The token is encrypted before it touches
 * the database and the plaintext is never logged or returned again -- only a masked tail, for confirmation. */
export async function saveWhatsAppConnection(tx: Tx, input: { phoneNumberId: string; wabaId?: string; displayNumber?: string; accessToken: string; templateName?: string }) {
  const existing = (await tx.query(`SELECT id FROM channel_connections WHERE channel = 'whatsapp' LIMIT 1`)).rows[0] as { id: string } | undefined;
  const encrypted = encryptSecret(input.accessToken);
  const templateStatus = input.templateName ? `${input.templateName}:pending_approval` : null;
  if (existing) {
    await tx.query(
      `UPDATE channel_connections SET phone_number_id = $1, waba_id = $2, display_number = $3, token_secret_ref = $4,
         template_status = COALESCE($5, template_status), status = 'active', connected_at = now() WHERE id = $6`,
      [input.phoneNumberId, input.wabaId ?? null, input.displayNumber ?? null, encrypted, templateStatus, existing.id]);
  } else {
    await tx.query(
      `INSERT INTO channel_connections (tenant_id, channel, phone_number_id, waba_id, display_number, token_secret_ref, template_status, status, connected_at)
       VALUES (current_tenant_id(), 'whatsapp', $1, $2, $3, $4, $5, 'active', now())`,
      [input.phoneNumberId, input.wabaId ?? null, input.displayNumber ?? null, encrypted, templateStatus]);
  }
  return { masked: maskSecret(input.accessToken) };
}

export async function disconnectWhatsApp(tx: Tx) {
  await tx.query(`UPDATE channel_connections SET status = 'disconnected' WHERE channel = 'whatsapp'`);
}
