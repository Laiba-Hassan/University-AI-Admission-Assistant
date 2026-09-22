import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

// Bot challenge (PRD Section 6.1/11): Cloudflare Turnstile before the FIRST message of a new conversation, not on
// every message. Pluggable like the LLM provider so tests never call Cloudflare.
export interface ChallengeVerifier { verify(token: string, remoteIp: string | undefined): Promise<boolean> }

export class TurnstileVerifier implements ChallengeVerifier {
  async verify(token: string, remoteIp: string | undefined): Promise<boolean> {
    if (!config.TURNSTILE_SECRET_KEY) return false;
    const body = new URLSearchParams({ secret: config.TURNSTILE_SECRET_KEY, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) });
    try {
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return false;
      const json = (await res.json()) as { success: boolean };
      return json.success === true;
    } catch {
      return false; // network failure is treated as "not verified", never silently allowed through
    }
  }
}

const CHALLENGE_TTL_SECONDS = 30 * 60; // must start a conversation within this window of passing the challenge

/** A short-lived, HMAC-signed pass proving this (tenant, session) cleared the bot challenge once. */
export function issueChallengePass(tenantId: string, sessionId: string): string {
  const exp = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS;
  const payload = `${tenantId}.${sessionId}.${exp}`;
  const sig = createHmac("sha256", config.CHALLENGE_SIGNING_SECRET).update(payload).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyChallengePass(pass: string | undefined, tenantId: string, sessionId: string): boolean {
  if (!pass) return false;
  const [expStr, sig] = pass.split(".");
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const payload = `${tenantId}.${sessionId}.${exp}`;
  const expected = createHmac("sha256", config.CHALLENGE_SIGNING_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
