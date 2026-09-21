import { Router } from "express";
import { withTenant } from "../db.js";
import { searchKnowledge } from "../knowledge.js";
import { recordUsage } from "../usage.js";
import { resolveWidgetTenant, tenantOf } from "../tenancy.js";

// Public web-widget API. Tenant comes from the widget key + Origin allow-list, never from the request body.
// Rate limits, Turnstile and monthly caps are added in Phase 4 before this is publicly reachable.
export const widgetRouter = Router();
widgetRouter.use(resolveWidgetTenant);

widgetRouter.get("/config", async (req, res, next) => {
  try {
    const config = await withTenant(tenantOf(req), async (tx) => {
      const t = (await tx.query("SELECT name, branding, welcome_message, default_reply_script FROM tenants")).rows[0];
      const messages = (await tx.query("SELECT key, language, text FROM localized_messages ORDER BY key, language")).rows;
      return { ...t, localized_messages: messages };
    });
    res.json(config);
  } catch (err) { next(err); }
});

widgetRouter.get("/search", async (req, res, next) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length > 500) return res.status(400).json({ error: "invalid_query" });
  try {
    const results = await withTenant(tenantOf(req), (tx) => searchKnowledge(tx, q, 5, "web"));
    res.json({ results: results.map(({ content, title, score }) => ({ content, title, score })) });
  } catch (err) { next(err); }
});

// Session start metering (one row per widget session); conversation limits read this in Phase 4.
widgetRouter.post("/session", async (req, res, next) => {
  try {
    await withTenant(tenantOf(req), (tx) => recordUsage(tx, "widget_session", "web"));
    res.status(204).end();
  } catch (err) { next(err); }
});
