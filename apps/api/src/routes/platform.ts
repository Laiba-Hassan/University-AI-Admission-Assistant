import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { staffCors } from "../cors.js";
import { withoutTenant, withTenant } from "../db.js";
import { getOverview } from "../overview.js";
import { getTeam, inviteStaff } from "../settings.js";
import { resolvePlatformAdmin } from "../tenancy.js";

// The Super Admin surface (PRD Phase 7): access-request review, and a read-only cross-tenant view of every
// university on the platform. Gated entirely by resolvePlatformAdmin -- a platform admin is not a member of
// any tenant, so nothing here goes through the normal staffRouter/resolveStaffTenant path.
export const platformRouter = Router();
platformRouter.use(staffCors, resolvePlatformAdmin);

platformRouter.get("/access-requests", async (req, res, next) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  try {
    const rows = await withoutTenant((tx) =>
      status
        ? tx.query(`SELECT * FROM access_requests WHERE status = $1 ORDER BY created_at DESC`, [status])
        : tx.query(`SELECT * FROM access_requests ORDER BY created_at DESC`));
    res.json({ requests: rows.rows });
  } catch (err) { next(err); }
});

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "university";

const Approve = z.object({ subdomain: z.string().trim().min(2).max(63).regex(/^[a-z0-9-]+$/).optional() });

platformRouter.post("/access-requests/:id/approve", async (req, res, next) => {
  const body = Approve.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const result = await withoutTenant(async (tx) => {
      const reqRow = (await tx.query(`SELECT * FROM access_requests WHERE id = $1 AND status = 'pending'`, [req.params.id])).rows[0] as
        | { id: string; university_name: string; contact_name: string; email: string }
        | undefined;
      if (!reqRow) return null;

      let subdomain = body.data.subdomain ?? slugify(reqRow.university_name);
      for (let attempt = 0; ; attempt++) {
        const taken = (await tx.query(`SELECT 1 FROM tenants WHERE subdomain = $1`, [subdomain])).rowCount;
        if (!taken) break;
        subdomain = `${body.data.subdomain ?? slugify(reqRow.university_name)}-${attempt + 2}`;
      }

      // The tenants RLS policy is WITH CHECK (id = current_tenant_id()): inserting a self-generated id, having
      // first set that same id as this transaction's tenant context (SET LOCAL, same mechanism withTenant()
      // uses), satisfies it without bypassing RLS at all -- exactly what seed.ts does under app_migrator, just
      // via the app's own app_user role. tenant_limits and the staff_invite below land in the same context.
      const tenantId = randomUUID();
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await tx.query(`INSERT INTO tenants (id, name, subdomain) VALUES ($1, $2, $3)`, [tenantId, reqRow.university_name, subdomain]);
      await tx.query(`INSERT INTO tenant_limits (tenant_id) VALUES ($1)`, [tenantId]);
      const token = randomBytes(24).toString("hex");
      await inviteStaff(tx, reqRow.email, "admin", createHash("sha256").update(token).digest("hex"), req.platformAdmin!.authUserId);

      await tx.query(
        `UPDATE access_requests SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
        [reqRow.id, req.platformAdmin!.email]);
      return { id: tenantId, name: reqRow.university_name, subdomain, inviteToken: token };
    });
    if (!result) return res.status(404).json({ error: "not_found_or_already_reviewed" });
    // The raw invite token is returned once, same as staff.ts's own invite route -- delivering it to the new
    // admin (email, Phase 7 automations) is a separate concern from creating it.
    res.status(201).json({ tenant_id: result.id, tenant_name: result.name, subdomain: result.subdomain, invite_token: result.inviteToken });
  } catch (err) { next(err); }
});

const Reject = z.object({ reason: z.string().trim().max(500).optional() });

platformRouter.post("/access-requests/:id/reject", async (req, res, next) => {
  const body = Reject.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const updated = await withoutTenant((tx) =>
      tx.query(
        `UPDATE access_requests SET status = 'rejected', reviewed_by = $2, reviewed_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [req.params.id, req.platformAdmin!.email]));
    if (!updated.rowCount) return res.status(404).json({ error: "not_found_or_already_reviewed" });
    res.json({ status: "rejected" });
  } catch (err) { next(err); }
});

platformRouter.get("/tenants", async (_req, res, next) => {
  try {
    const rows = await withoutTenant((tx) => tx.query(`SELECT * FROM platform_list_tenants()`));
    res.json({ tenants: rows.rows });
  } catch (err) { next(err); }
});

platformRouter.get("/tenants/:id", async (req, res, next) => {
  try {
    const base = (await withoutTenant((tx) =>
      tx.query(`SELECT * FROM platform_list_tenants() WHERE id = $1`, [req.params.id]))).rows[0];
    if (!base) return res.status(404).json({ error: "not_found" });
    // Everything below reads WITHIN this one tenant's own RLS context -- a platform admin choosing which
    // tenant to look at, not a cross-tenant query -- exactly the PRD's "read-only tenant support view".
    const [team, overview] = await withTenant(req.params.id, async (tx) => [await getTeam(tx), await getOverview(tx, "30d")]);
    res.json({ ...base, team, overview });
  } catch (err) { next(err); }
});

const TenantStatus = z.object({ status: z.enum(["active", "suspended"]) });

platformRouter.post("/tenants/:id/status", async (req, res, next) => {
  const body = TenantStatus.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withoutTenant((tx) => tx.query(`SELECT platform_set_tenant_status($1, $2)`, [req.params.id, body.data.status]));
    res.json({ status: body.data.status });
  } catch (err) { next(err); }
});
