import { Router } from "express";
import { z } from "zod";
import { handleMessage, requestHandoff } from "../agent/conversation.js";
import type { LlmProvider } from "../agent/llm.js";
import { verifyChallengePass } from "../challenge.js";
import { publicCors } from "../cors.js";
import { withTenant } from "../db.js";
import { resolveWidgetTenant, tenantOf } from "../tenancy.js";
import { publicRateLimit } from "./rate-limit-middleware.js";

// POST /api/chat: web-widget entry to the shared conversation core. Tenant comes from widget key + origin only.
const SESSION_ID = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const LANGUAGE = z.enum(["english", "roman_urdu", "urdu"]).optional();
const Body = z.object({ message: z.string().trim().min(1).max(1000), session_id: SESSION_ID, language: LANGUAGE });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Feedback = z.object({ message_id: z.string().regex(UUID), rating: z.union([z.literal(1), z.literal(-1)]) });
const Handoff = z.object({ session_id: SESSION_ID, reason: z.string().trim().max(200).optional() });

// llmProvider is injectable (defaults to the real Gemini provider inside handleMessage when omitted) so tests can
// exercise the full public HTTP surface -- rate limiting, the challenge gate, feedback, handoff -- without spending
// real API quota. Mirrors how whatsappRouter takes `enqueue` and widgetRouter takes a ChallengeVerifier.
export function chatRouter(llmProvider?: LlmProvider) {
  const router = Router();
  router.use(publicCors, resolveWidgetTenant, publicRateLimit);

  router.post("/", async (req, res) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "invalid_request" });
    try {
      const tenantId = tenantOf(req);
      // The bot challenge only gates STARTING a new conversation; an existing open one can keep going without it, so
      // it is checked only when no open conversation already exists for this session.
      const hasOpenConversation = await withTenant(tenantId, async (tx) =>
        Boolean((await tx.query(
          `SELECT 1 FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
            WHERE ct.channel = 'web' AND ct.external_id = $1 AND c.status <> 'closed' LIMIT 1`, [body.data.session_id])).rows[0]));
      if (!hasOpenConversation) {
        const pass = req.header("x-challenge-pass") ?? undefined;
        if (!verifyChallengePass(pass, tenantId, body.data.session_id)) return res.status(403).json({ error: "challenge_required" });
      }
      const out = await handleMessage({ tenantId, channel: "web", externalId: body.data.session_id, text: body.data.message, forcedLanguage: body.data.language, provider: llmProvider });
      // Debug internals (tool calls, verifier details) are never sent to the client.
      res.json({ reply: out.reply, status: out.status, language: out.language, cards: out.cards, message_id: out.messageId, conversation_id: out.conversationId });
    } catch (err) {
      console.error("chat failed:", err instanceof Error ? err.message : err);
      res.status(503).json({ error: "unavailable" }); // the widget shows its "unavailable, please contact admissions" state
    }
  });

  router.post("/feedback", async (req, res) => {
    const body = Feedback.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "invalid_request" });
    try {
      await withTenant(tenantOf(req), (tx) =>
        // The composite FK (tenant_id, message_id) -> messages(tenant_id, id) is what actually enforces this is the
        // caller's own message: a message id from another tenant has no matching row under this tenant_id, so the
        // insert is rejected at the constraint, not merely filtered by RLS.
        tx.query(
          `INSERT INTO message_feedback (tenant_id, message_id, rating) VALUES (current_tenant_id(), $1, $2)
           ON CONFLICT (message_id) DO UPDATE SET rating = EXCLUDED.rating`, [body.data.message_id, body.data.rating]));
      res.status(204).end();
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "23503") return res.status(404).json({ error: "not_found" }); // foreign_key_violation
      console.error("feedback failed:", err instanceof Error ? err.message : err);
      res.status(503).json({ error: "unavailable" });
    }
  });

  // The widget's always-visible "Talk to admissions" button: hands off regardless of what the model would decide.
  router.post("/handoff", async (req, res) => {
    const body = Handoff.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "invalid_request" });
    try {
      const { conversationId } = await requestHandoff(tenantOf(req), "web", body.data.session_id, body.data.reason?.trim() || "student requested a person");
      res.json({ status: "handoff_requested", conversation_id: conversationId });
    } catch (err) {
      console.error("handoff failed:", err instanceof Error ? err.message : err);
      res.status(503).json({ error: "unavailable" });
    }
  });

  return router;
}
