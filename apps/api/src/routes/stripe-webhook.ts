import express, { Router } from "express";
import { config } from "../config.js";
import { handleStripeEvent, verifyWebhookEvent } from "../billing.js";

// Stripe's own notification of a renewal succeeding or failing (billing.ts): the raw body is signature-verified
// before anything is parsed or acted on, same fail-closed shape as the WhatsApp webhook's own HMAC check --
// an unsigned or badly signed request updates nothing and the error never reveals which check failed.
export function stripeWebhookRouter() {
  const router = Router();
  router.post("/", express.raw({ type: "application/json", limit: "1mb" }), async (req, res, next) => {
    try {
      if (!config.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: "webhook_not_configured" });
      const raw = req.body as Buffer;
      if (!Buffer.isBuffer(raw)) return res.sendStatus(400);
      const event = verifyWebhookEvent(raw, req.header("stripe-signature"));
      if (!event) return res.sendStatus(401);
      await handleStripeEvent(event);
      res.sendStatus(200);
    } catch (err) { next(err); }
  });
  return router;
}
