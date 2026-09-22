import type { RequestHandler } from "express";

// CORS for the public widget/chat routes. A widget embedded on a real university site is ALWAYS cross-origin from
// wherever this API is hosted, so without these headers the browser blocks the response before our own code -- the
// widget-key + origin allowlist in tenancy.ts -- ever runs. Reflecting the request's Origin here is standard and
// safe: CORS only controls whether client-side JS may READ a cross-origin response, it grants no access by itself.
// The actual authorization decision stays with resolveWidgetTenant's key+origin check, not with this header.
export const publicCors: RequestHandler = (req, res, next) => {
  const origin = req.header("origin");
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET, POST");
  res.setHeader("access-control-allow-headers", "content-type, x-widget-key, x-challenge-pass");
  res.setHeader("access-control-max-age", "600");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
};
