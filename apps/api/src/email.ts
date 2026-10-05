import dns from "node:dns";
import nodemailer from "nodemailer";
import { config } from "./config.js";

// Railway's network has no outbound IPv6 route, but Node resolves smtp.gmail.com's IPv6 address first by
// default -- ENETUNREACH, every time, on a host that works fine over IPv4. Nodemailer's own TS types don't
// expose a `family` option to force this per-transport, so it's set globally instead (safe: this process makes
// no other outbound IPv6 connections).
dns.setDefaultResultOrder("ipv4first");

// Generic SMTP sender (Gmail with an App Password, or any other provider) -- deliberately not tied to one
// vendor's API. Mirrors VAPID/push's own pattern: silently no-op when unconfigured instead of throwing, so local
// dev without real credentials keeps working and callers decide what "not actually sent" means for their flow.
let transporter: ReturnType<typeof nodemailer.createTransport> | null | undefined;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) return (transporter = null);
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  return transporter;
}

export const emailConfigured = () => getTransporter() !== null;

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  await t.sendMail({ from: config.SMTP_FROM ?? config.SMTP_USER, to, subject, html });
  return true;
}
