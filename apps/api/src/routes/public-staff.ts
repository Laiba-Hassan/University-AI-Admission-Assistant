import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { staffCors } from "../cors.js";
import { withoutTenant } from "../db.js";
import { acceptStaffInvite } from "../invites.js";
import { verifyAuthUser } from "../tenancy.js";

// Unauthenticated: a brand-new university has no tenant, no staff account and no widget key yet -- this is the
// self-serve "Create account" flow's landing spot before a platform admin approves or rejects the request (see
// the super-admin Tenants page: "Pending approval" queue, backed by this same access_requests table).
const Request = z.object({
  university_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional(),
});

export const publicStaffRouter = Router();
publicStaffRouter.use(staffCors);

publicStaffRouter.post("/access-requests", async (req, res, next) => {
  const body = Request.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withoutTenant((tx) =>
      tx.query(
        `INSERT INTO access_requests (university_name, contact_name, email, phone) VALUES ($1, $2, $3, $4)`,
        [body.data.university_name, body.data.contact_name, body.data.email, body.data.phone ?? null],
      ));
    res.status(201).json({ status: "pending" });
  } catch (err) { next(err); }
});

// The invited person already has (or just created) a Supabase account -- verified here from their own bearer
// token, never trusted from the request body -- but no tenant membership yet, so this can't go through the
// normal staffRouter (resolveStaffTenant would reject them for exactly that reason).
const AcceptInvite = z.object({ token: z.string().trim().min(32).max(200) });
publicStaffRouter.post("/invites/accept", async (req, res, next) => {
  const body = AcceptInvite.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  const authUserId = await verifyAuthUser(req);
  if (!authUserId) return res.status(401).json({ error: "unauthorized" });
  try {
    const tokenHash = createHash("sha256").update(body.data.token).digest("hex");
    const result = await withoutTenant((tx) => acceptStaffInvite(tx, tokenHash, authUserId));
    if (!result) return res.status(404).json({ error: "invalid_or_expired_invite" });
    res.json({ tenantId: result.tenant_id, tenantName: result.tenant_name, role: result.role });
  } catch (err) { next(err); }
});
