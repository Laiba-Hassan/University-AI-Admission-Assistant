import { config } from "./config.js";

// Resend's HTTP API (port 443) rather than raw SMTP: Railway blocks outbound SMTP ports entirely (confirmed --
// every send hung for the full 2-minute connection timeout, independent of credentials), which is standard
// anti-spam policy on most PaaS hosts. Mirrors VAPID/push's own pattern: silently no-op when unconfigured
// instead of throwing, so local dev without a real key keeps working and callers decide what "not actually
// sent" means for their flow.
export const emailConfigured = () => Boolean(config.RESEND_API_KEY);

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.SMTP_FROM ?? "Enrollium <onboarding@resend.dev>", to, subject, html }),
  });
  return res.ok;
}
