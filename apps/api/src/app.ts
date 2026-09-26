import express, { type ErrorRequestHandler } from "express";
import type { LlmProvider } from "./agent/llm.js";
import type { ChallengeVerifier } from "./challenge.js";
import { pool } from "./db.js";
import type { Enqueue } from "./queue.js";
import { chatRouter } from "./routes/chat.js";
import { publicStaffRouter } from "./routes/public-staff.js";
import { staffRouter } from "./routes/staff.js";
import { widgetRouter } from "./routes/widget.js";
import { whatsappRouter } from "./routes/whatsapp.js";

export function createApp(enqueue: Enqueue, challenge?: ChallengeVerifier, llmProvider?: LlmProvider) {
  const app = express();
  app.disable("x-powered-by");
  // Render/Railway/Fly.io sit behind exactly one reverse-proxy hop; trusting it is what makes req.ip the real
  // client IP (for rate limiting) instead of the proxy's own address. Harmless for local development (no proxy).
  app.set("trust proxy", 1);

  // The webhook needs the raw body for signature verification, so it is mounted before the JSON parser.
  app.use("/webhooks/whatsapp", whatsappRouter(enqueue));
  app.use(express.json({ limit: "100kb" }));

  app.get("/healthz", async (_req, res) => {
    try { await pool.query("SELECT 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });
  app.use("/api/v1", staffRouter);
  app.use("/api/public", publicStaffRouter);
  app.use("/api/widget", widgetRouter(challenge));
  app.use("/api/chat", chatRouter(llmProvider));

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  // Never expose SQL, stack traces or internals to callers (PRD Section 11).
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("request failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal_error" });
  };
  app.use(onError);
  return app;
}
