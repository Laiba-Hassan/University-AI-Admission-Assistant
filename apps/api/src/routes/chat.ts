import { Router } from "express";
import { z } from "zod";
import { handleMessage } from "../agent/conversation.js";
import { resolveWidgetTenant, tenantOf } from "../tenancy.js";

// POST /api/chat: web-widget entry to the shared conversation core. Tenant comes from widget key + origin only.
// (Rate limits, Turnstile and monthly caps are added in Phase 4, before this is publicly reachable.)
const Body = z.object({
  message: z.string().trim().min(1).max(1000),
  session_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export const chatRouter = Router();
chatRouter.post("/", resolveWidgetTenant, async (req, res) => {
  const body = Body.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const out = await handleMessage({ tenantId: tenantOf(req), channel: "web", externalId: body.data.session_id, text: body.data.message });
    // Debug internals (tool calls, verifier details) are never sent to the client.
    res.json({ reply: out.reply, status: out.status, language: out.language, cards: out.cards });
  } catch (err) {
    console.error("chat failed:", err instanceof Error ? err.message : err);
    res.status(503).json({ error: "unavailable" }); // the widget shows its "unavailable, please contact admissions" state
  }
});
