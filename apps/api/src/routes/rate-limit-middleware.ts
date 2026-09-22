import type { RequestHandler } from "express";
import { config } from "../config.js";
import { checkLimits } from "../ratelimit.js";

// Applied to the public widget/chat endpoints only (PRD Section 11: per-IP / per-session / per-tenant rate limits,
// enforced "from the first public deployment"). Must run after resolveWidgetTenant (needs req.tenant) and after
// express.json() (reads session_id from the body or query so a per-session limit can be applied where available).
export const publicRateLimit: RequestHandler = async (req, res, next) => {
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(403).json({ error: "forbidden" });
    const sessionId = (typeof req.body?.session_id === "string" && req.body.session_id) || (typeof req.query.session_id === "string" && req.query.session_id) || undefined;
    const limits = [
      { key: `ip:${req.ip}`, windowSeconds: 60, max: config.RATE_LIMIT_PER_IP_PER_MINUTE },
      { key: `tenant:${tenantId}`, windowSeconds: 60, max: config.RATE_LIMIT_PER_TENANT_PER_MINUTE },
      ...(sessionId ? [{ key: `session:${tenantId}:${sessionId}`, windowSeconds: 60, max: config.RATE_LIMIT_PER_SESSION_PER_MINUTE }] : []),
    ];
    const { ok } = await checkLimits(limits);
    if (!ok) return res.status(429).json({ error: "rate_limited" });
    next();
  } catch (err) { next(err); }
};
