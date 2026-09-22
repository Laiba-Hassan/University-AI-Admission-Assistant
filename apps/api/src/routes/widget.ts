import { Router } from "express";
import { z } from "zod";
import { TurnstileVerifier, issueChallengePass, type ChallengeVerifier } from "../challenge.js";
import { config } from "../config.js";
import { withTenant } from "../db.js";
import { searchKnowledge } from "../knowledge.js";
import { recordUsage } from "../usage.js";
import { resolveWidgetTenant, tenantOf } from "../tenancy.js";
import { publicRateLimit } from "./rate-limit-middleware.js";

// Public web-widget API. Tenant comes from the widget key + Origin allow-list, never from the request body.
export function widgetRouter(challenge?: ChallengeVerifier) {
  // The dev bypass only applies to the REAL default verifier with no Cloudflare secret configured (so local
  // development works without a Cloudflare account). An explicitly injected verifier -- including a test fake --
  // is always consulted, never short-circuited, so its result actually controls the outcome.
  const usingDefaultVerifier = !challenge;
  const verifier = challenge ?? new TurnstileVerifier();
  const router = Router();
  router.use(resolveWidgetTenant, publicRateLimit);

  router.get("/config", async (req, res, next) => {
    try {
      const payload = await withTenant(tenantOf(req), async (tx) => {
        const t = (await tx.query("SELECT name, branding, welcome_message, default_reply_script FROM tenants")).rows[0];
        const messages = (await tx.query("SELECT key, language, text FROM localized_messages ORDER BY key, language")).rows;
        // "Most common questions" bootstraps from the approved FAQ list until there is real usage data to rank by.
        const suggested = (await tx.query("SELECT question FROM faqs WHERE approved ORDER BY id LIMIT 4")).rows.map((r) => r.question as string);
        return { ...t, localized_messages: messages, suggested_questions: suggested, turnstile_site_key: config.TURNSTILE_SITE_KEY ?? null };
      });
      res.json(payload);
    } catch (err) { next(err); }
  });

  router.get("/search", async (req, res, next) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q || q.length > 500) return res.status(400).json({ error: "invalid_query" });
    try {
      const results = await withTenant(tenantOf(req), (tx) => searchKnowledge(tx, q, 5, "web"));
      res.json({ results: results.map(({ content, title, score }) => ({ content, title, score })) });
    } catch (err) { next(err); }
  });

  // Bot challenge (PRD 6.1/11): once per new widget session, before the first chat message. Returns a short-lived
  // signed pass the client presents on POST /api/chat to start a conversation.
  const Session = z.object({ session_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), turnstile_token: z.string().min(1).max(4000) });
  router.post("/session", async (req, res, next) => {
    const body = Session.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "invalid_request" });
    try {
      const tenantId = tenantOf(req);
      const devBypass = usingDefaultVerifier && config.NODE_ENV !== "production" && !config.TURNSTILE_SECRET_KEY;
      const ok = devBypass || (await verifier.verify(body.data.turnstile_token, req.ip));
      if (!ok) return res.status(403).json({ error: "challenge_failed" });
      await withTenant(tenantId, (tx) => recordUsage(tx, "widget_session", "web"));
      res.json({ challenge_pass: issueChallengePass(tenantId, body.data.session_id) });
    } catch (err) { next(err); }
  });

  return router;
}
