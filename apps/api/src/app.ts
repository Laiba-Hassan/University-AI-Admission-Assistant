import express, { type ErrorRequestHandler } from "express";
import type { LlmProvider } from "./agent/llm.js";
import type { SttProvider } from "./voice/transcribe.js";
import type { ChallengeVerifier } from "./challenge.js";
import { pool } from "./db.js";
import type { Enqueue } from "./queue.js";
import { chatRouter } from "./routes/chat.js";
import { platformRouter } from "./routes/platform.js";
import { publicStaffRouter } from "./routes/public-staff.js";
import { staffRouter } from "./routes/staff.js";
import { stripeWebhookRouter } from "./routes/stripe-webhook.js";
import { widgetRouter } from "./routes/widget.js";
import { whatsappRouter } from "./routes/whatsapp.js";

export function createApp(enqueue: Enqueue, challenge?: ChallengeVerifier, llmProvider?: LlmProvider, sttProvider?: SttProvider) {
  const app = express();
  app.disable("x-powered-by");
  // Render/Railway/Fly.io sit behind exactly one reverse-proxy hop; trusting it is what makes req.ip the real
  // client IP (for rate limiting) instead of the proxy's own address. Harmless for local development (no proxy).
  app.set("trust proxy", 1);

  // Both webhooks need the raw body for signature verification, so both are mounted before the JSON parser.
  app.use("/webhooks/whatsapp", whatsappRouter(enqueue));
  app.use("/webhooks/stripe", stripeWebhookRouter());
  // 1mb, not 100kb: branding.logo carries a base64 data URL (up to ~300KB of image -> ~400KB encoded).
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", async (_req, res) => {
    try { await pool.query("SELECT 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });
  app.use("/api/v1", staffRouter);
  app.use("/api/platform", platformRouter);
  app.use("/api/public", publicStaffRouter);
  app.use("/api/widget", widgetRouter(challenge));
  app.use("/api/chat", chatRouter(llmProvider, sttProvider));

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  // Never expose SQL, stack traces or internals to callers (PRD Section 11).
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("request failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal_error" });
  };
  app.use(onError);
  return app;
}
