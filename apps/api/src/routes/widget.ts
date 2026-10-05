import { Router } from "express";
import { z } from "zod";
import { TurnstileVerifier, issueChallengePass, type ChallengeVerifier } from "../challenge.js";
import { config } from "../config.js";
import { publicCors } from "../cors.js";
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
  router.use(publicCors, resolveWidgetTenant, publicRateLimit);

  router.get("/config", async (req, res, next) => {
    try {
      const payload = await withTenant(tenantOf(req), async (tx) => {
        const t = (await tx.query("SELECT name, branding, welcome_message, default_reply_script FROM tenants")).rows[0];
        const messages = (await tx.query("SELECT key, language, text FROM localized_messages ORDER BY key, language")).rows;
        // Featured-and-approved FAQs first (a university deliberately curating its starter chips), falling back
        // to plain approved-FAQ order to fill any remaining slots so this is never empty for an unconfigured tenant.
        const suggested = (await tx.query("SELECT question FROM faqs WHERE approved ORDER BY featured DESC, id LIMIT 4")).rows.map((r) => r.question as string);
        return { ...t, localized_messages: messages, suggested_questions: suggested, turnstile_site_key: config.TURNSTILE_SITE_KEY ?? null };
      });
      res.json(payload);
    } catch (err) { next(err); }
  });

  // Lets the widget show a conversation's history on resume (same session_id, a later page load -- loader.js
  // already persists it in localStorage) and poll for anything new (a staff reply typed from the Inbox while the
  // panel was minimized/closed). `since` makes it one endpoint for both: omitted = full history, present =
  // only what's arrived after it. No conversation for this session yet is not an error, just an empty list.
  router.get("/messages", async (req, res, next) => {
    const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
    if (!sessionId) return res.status(400).json({ error: "invalid_request" });
    const since = typeof req.query.since === "string" ? new Date(req.query.since) : null;
    if (since && Number.isNaN(since.getTime())) return res.status(400).json({ error: "invalid_request" });
    try {
      const rows = await withTenant(tenantOf(req), async (tx) => (await tx.query(
        `SELECT m.id, m.role, m.content, m.detected_language, m.metadata, m."timestamp"
           FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN contacts ct ON ct.id = c.contact_id
          WHERE ct.channel = 'web' AND ct.external_id = $1 ${since ? "AND m.\"timestamp\" > $2" : ""}
          ORDER BY m."timestamp" ASC LIMIT 50`,
        since ? [sessionId, since] : [sessionId])).rows as { id: string; role: string; content: string; detected_language: string | null; metadata: { cards?: unknown }; timestamp: Date }[]);
      res.json({ messages: rows.map((r) => ({ id: r.id, role: r.role, content: r.content, language: r.detected_language, cards: r.metadata?.cards ?? [], timestamp: r.timestamp })) });
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
