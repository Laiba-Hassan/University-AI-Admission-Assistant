import express, { type ErrorRequestHandler } from "express";
import { pool } from "./db.js";
import type { Enqueue } from "./queue.js";
import { chatRouter } from "./routes/chat.js";
import { staffRouter } from "./routes/staff.js";
import { widgetRouter } from "./routes/widget.js";
import { whatsappRouter } from "./routes/whatsapp.js";

export function createApp(enqueue: Enqueue) {
  const app = express();
  app.disable("x-powered-by");

  // The webhook needs the raw body for signature verification, so it is mounted before the JSON parser.
  app.use("/webhooks/whatsapp", whatsappRouter(enqueue));
  app.use(express.json({ limit: "100kb" }));

  app.get("/healthz", async (_req, res) => {
    try { await pool.query("SELECT 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });
  app.use("/api/v1", staffRouter);
  app.use("/api/widget", widgetRouter);
  app.use("/api/chat", chatRouter);

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  // Never expose SQL, stack traces or internals to callers (PRD Section 11).
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("request failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal_error" });
  };
  app.use(onError);
  return app;
}
