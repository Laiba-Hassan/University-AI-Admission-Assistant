import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "./config.js";

// Per-tenant WhatsApp access tokens are never stored in plaintext (PRD Section 11: "encrypted per-tenant tokens
// that never appear in logs"). AES-256-GCM with a server-held key from config.SECRETS_ENCRYPTION_KEY; the
// ciphertext (iv + authTag + encrypted bytes, base64) is what actually lives in channel_connections.token_secret_ref
// -- "_ref" is a naming holdover from an earlier design that pointed at a separate vault, not a real indirection.
function key() {
  const raw = Buffer.from(config.SECRETS_ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of a 256-bit key)");
  return raw;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12), authTag = buf.subarray(12, 28), encrypted = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** For display: the last 4 characters only, e.g. "••••••7f3a" -- enough for a staff member to tell which token
 * they're looking at without ever re-showing the secret itself (PRD: "never displayed after entry"). */
export function maskSecret(plaintext: string): string {
  return `••••••${plaintext.slice(-4)}`;
}
