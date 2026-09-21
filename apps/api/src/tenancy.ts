import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { config } from "./config.js";
import { withoutTenant } from "./db.js";

export type Role = "admin" | "editor" | "viewer";
export interface TenantContext { id: string; via: "session" | "widget" | "whatsapp"; role?: Role; authUserId?: string }

declare global {
  namespace Express {
    interface Request { tenant?: TenantContext }
  }
}

// Tenant identity is always resolved server-side from something the client cannot forge (a verified session,
// an origin-checked widget key, or a signature-verified webhook), never from a client-supplied tenant id.
// Failures are deliberately uniform so responses reveal nothing about which tenants or keys exist.
const deny = (res: Response, status: 401 | 403, error: string) => res.status(status).json({ error });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- widget: public key + origin allow-list
export const resolveWidgetTenant: RequestHandler = async (req, res, next) => {
  const key = req.header("x-widget-key");
  const origin = req.header("origin");
  if (!key || !origin) return deny(res, 403, "forbidden");
  try {
    const id = await resolveTenantByWidgetKey(key, origin);
    if (!id) return deny(res, 403, "forbidden");
    req.tenant = { id, via: "widget" };
    next();
  } catch (err) { next(err); }
};

export const resolveTenantByWidgetKey = (key: string, origin: string) =>
  withoutTenant(async (tx) => (await tx.query("SELECT resolve_tenant_by_widget_key($1, $2) AS id", [key, origin])).rows[0]?.id as string | null);

// ---------------------------------------------------------------- WhatsApp: phone_number_id from a verified webhook
export const resolveTenantByPhoneNumberId = (phoneNumberId: string) =>
  withoutTenant(async (tx) => (await tx.query("SELECT resolve_tenant_by_phone_number_id($1) AS id", [phoneNumberId])).rows[0]?.id as string | null);

// ---------------------------------------------------------------- staff: Supabase Auth session -> tenant_users
let keys: JWTVerifyGetKey | Uint8Array | undefined;
function verificationKey() {
  if (keys) return keys;
  if (config.SUPABASE_JWKS_URL) keys = createRemoteJWKSet(new URL(config.SUPABASE_JWKS_URL));
  else if (config.SUPABASE_JWT_SECRET) keys = new TextEncoder().encode(config.SUPABASE_JWT_SECRET);
  return keys;
}

export const resolveStaffTenant: RequestHandler = async (req, res, next) => {
  const token = req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  const key = verificationKey();
  if (!token) return deny(res, 401, "unauthorized");
  if (!key) return res.status(503).json({ error: "auth_not_configured" });
  try {
    const { payload } = await jwtVerify(token, key as never, { audience: "authenticated" });
    if (!payload.sub || !UUID.test(payload.sub)) return deny(res, 401, "unauthorized");
    const memberships = await withoutTenant(async (tx) =>
      (await tx.query("SELECT tenant_id, role FROM resolve_tenants_by_auth_user($1)", [payload.sub])).rows as { tenant_id: string; role: Role }[]);
    // A user may belong to several tenants; X-Tenant-Id only *selects among memberships*, it never grants access.
    const wanted = req.header("x-tenant-id");
    const chosen = wanted ? memberships.find((m) => m.tenant_id === wanted) : memberships.length === 1 ? memberships[0] : undefined;
    if (!chosen) return deny(res, 403, "forbidden");
    req.tenant = { id: chosen.tenant_id, via: "session", role: chosen.role, authUserId: payload.sub };
    next();
  } catch (err) {
    if (err instanceof errors.JOSEError) return deny(res, 401, "unauthorized");
    next(err);
  }
};

export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) =>
  req.tenant?.role && roles.includes(req.tenant.role) ? next() : deny(res, 403, "forbidden");

/** The tenant a handler must use. Throws if a route was mounted without a resolver. */
export const tenantOf = (req: Request): string => {
  if (!req.tenant) throw new Error("route reached without tenant resolution");
  return req.tenant.id;
};
