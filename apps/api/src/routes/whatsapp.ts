import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { config } from "../config.js";
import { QUEUES, type Enqueue } from "../queue.js";
import { resolveTenantByPhoneNumberId } from "../tenancy.js";

// Meta Cloud API webhook. Tenant is resolved from the receiving phone_number_id ONLY after the HMAC signature over
// the raw body has been verified; an unsigned or badly signed request stores and enqueues nothing.
export const validSignature = (raw: Buffer, header: string | undefined, secret: string) => {
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
};

export function whatsappRouter(enqueue: Enqueue) {
  const router = Router();

  // Meta's one-time subscription handshake.
  router.get("/", (req, res) => {
    const ok = config.WHATSAPP_VERIFY_TOKEN && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === config.WHATSAPP_VERIFY_TOKEN;
    return ok ? res.status(200).send(String(req.query["hub.challenge"] ?? "")) : res.sendStatus(403);
  });

  router.post("/", express.raw({ type: "application/json", limit: "1mb" }), async (req, res, next) => {
    try {
      if (!config.WHATSAPP_APP_SECRET) return res.status(503).json({ error: "webhook_not_configured" });
      const raw = req.body as Buffer;
      if (!Buffer.isBuffer(raw) || !validSignature(raw, req.header("x-hub-signature-256"), config.WHATSAPP_APP_SECRET)) return res.sendStatus(401);

      let body: { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[] };
      try { body = JSON.parse(raw.toString("utf-8")); } catch { return res.sendStatus(400); }

      for (const change of (body.entry ?? []).flatMap((e) => e.changes ?? [])) {
        const phoneNumberId = change.value?.metadata?.phone_number_id;
        const tenantId = phoneNumberId ? await resolveTenantByPhoneNumberId(phoneNumberId) : null;
        if (!tenantId) continue; // unknown number: acknowledge (so Meta stops retrying) but keep nothing
        await enqueue(QUEUES.whatsappInbound, { tenantId, change: change.value ?? {} });
      }
      res.sendStatus(200);
    } catch (err) { next(err); }
  });
  return router;
}
