import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { staffCors } from "../cors.js";
import { pool, withoutTenant, withTenant, type Tx } from "../db.js";
import { sendEmail } from "../email.js";
import { getOverview } from "../overview.js";
import { approvePasswordChange, getTeam, inviteStaff } from "../settings.js";
import { resolvePlatformAdmin } from "../tenancy.js";

// The Super Admin surface (PRD Phase 7, Enrollium_Super_Admin_Dashboard.pdf): access-request review, a
// read-only cross-tenant view of every university on the platform, manual billing tracking, usage & cost,
// platform health, sub-processors/DPA tracking, and an audit log of every platform-admin action. Gated entirely
// by resolvePlatformAdmin -- a platform admin is not a member of any tenant, so nothing here goes through the
// normal staffRouter/resolveStaffTenant path.
export const platformRouter = Router();
platformRouter.use(staffCors, resolvePlatformAdmin);

/** Every mutating platform-admin action lands here (Audit Log page). Best-effort: a logging failure must never
 * block the actual action, so callers await it but the route itself doesn't roll back on a log-insert error --
 * in practice this can't happen (same transaction, same table, no constraints beyond NOT NULL on known-good
 * values), but the audit trail existing is a courtesy, not the source of truth for whether the action happened. */
async function logPlatformAction(tx: Tx, adminEmail: string, action: string, target?: string, details?: string, metadata?: Record<string, unknown>) {
  await tx.query(
    `INSERT INTO platform_audit_log (admin_email, action, target, details, metadata) VALUES ($1,$2,$3,$4,$5)`,
    [adminEmail, action, target ?? null, details ?? null, JSON.stringify(metadata ?? {})]);
}

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
    // Each attempt is its own transaction (withoutTenant = BEGIN..COMMIT), so a conflict on the subdomain's
    // unique constraint can't be pre-checked with a SELECT: tenants has per-tenant RLS, and no tenant context
    // exists yet at that point, so the SELECT would always see zero rows regardless of what's actually taken --
    // it would never catch a real collision. Catching the actual unique_violation and retrying with the next
    // suffix is the only check that can't lie.
    let result: { id: string; name: string; subdomain: string; inviteToken: string; email: string } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        result = await withoutTenant(async (tx) => {
          const reqRow = (await tx.query(`SELECT * FROM access_requests WHERE id = $1 AND status = 'pending'`, [req.params.id])).rows[0] as
            | { id: string; university_name: string; contact_name: string; email: string }
            | undefined;
          if (!reqRow) return null;
          const base = body.data.subdomain ?? slugify(reqRow.university_name);
          const resolvedSubdomain = attempt === 0 ? base : `${base}-${attempt + 1}`;

          // The tenants RLS policy is WITH CHECK (id = current_tenant_id()): inserting a self-generated id, having
          // first set that same id as this transaction's tenant context (SET LOCAL, same mechanism withTenant()
          // uses), satisfies it without bypassing RLS at all -- exactly what seed.ts does under app_migrator, just
          // via the app's own app_user role. tenant_limits and the staff_invite below land in the same context.
          const tenantId = randomUUID();
          await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
          const defaults = (await tx.query(`SELECT default_plan_limits FROM platform_settings`)).rows[0]?.default_plan_limits as
            Record<string, { conversations: number; messages: number }> | undefined;
          const starter = defaults?.starter;
          await tx.query(`INSERT INTO tenants (id, name, subdomain) VALUES ($1, $2, $3)`, [tenantId, reqRow.university_name, resolvedSubdomain]);
          await tx.query(
            `INSERT INTO tenant_limits (tenant_id, monthly_conversation_limit, monthly_message_limit) VALUES ($1, COALESCE($2, 500), COALESCE($3, 5000))`,
            [tenantId, starter?.conversations, starter?.messages]);
          const token = randomBytes(24).toString("hex");
          await inviteStaff(tx, reqRow.email, "admin", createHash("sha256").update(token).digest("hex"), req.platformAdmin!.authUserId);

          await tx.query(
            `UPDATE access_requests SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
            [reqRow.id, req.platformAdmin!.email]);
          await logPlatformAction(tx, req.platformAdmin!.email, "approved_tenant", reqRow.university_name, "Approved pending signup request · Starter plan");
          return { id: tenantId, name: reqRow.university_name, subdomain: resolvedSubdomain, inviteToken: token, email: reqRow.email };
        });
        break;
      } catch (err) {
        const pgErr = err as { code?: string; constraint?: string };
        if (pgErr.code === "23505" && pgErr.constraint === "tenants_subdomain_key" && attempt < 4) continue;
        throw err;
      }
    }
    if (!result) return res.status(404).json({ error: "not_found_or_already_reviewed" });
    // Same pattern as staff.ts's own /invite route: the raw token only ever exists here and in this email --
    // the DB keeps only its hash. Unconfigured SMTP makes sendEmail a safe no-op (email.ts), which is why the
    // frontend still needs the raw token back regardless of whether this actually sent.
    const origin = req.header("origin") ?? "";
    const link = `${origin}/accept-invite?token=${result.inviteToken}`;
    // The tenant and invite are already committed at this point -- an SMTP hiccup (timeout, a provider briefly
    // rejecting the connection) must not turn an otherwise-successful approval into a 500 the admin has to retry
    // into a duplicate-subdomain situation. Same fallback either way: the frontend shows the raw link.
    let emailed = false;
    if (origin) {
      try {
        emailed = await sendEmail(result.email, `You're invited to join ${result.name}`,
          `<p>Your university, <strong>${result.name}</strong>, has been approved on Enrollium.</p>
           <p><a href="${link}">Accept the invite</a> to set up your admin account (expires in 7 days).</p>
           <p>If the link doesn't work, copy this into your browser:<br>${link}</p>`);
      } catch { /* emailed stays false -- the frontend banner falls back to the copyable link */ }
    }
    res.status(201).json({ tenant_id: result.id, tenant_name: result.name, subdomain: result.subdomain, invite_token: result.inviteToken, emailed });
  } catch (err) { next(err); }
});

const Reject = z.object({ reason: z.string().trim().max(500).optional() });

platformRouter.post("/access-requests/:id/reject", async (req, res, next) => {
  const body = Reject.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const result = await withoutTenant(async (tx) => {
      const updated = await tx.query(
        `UPDATE access_requests SET status = 'rejected', reviewed_by = $2, reviewed_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING university_name`,
        [req.params.id, req.platformAdmin!.email]);
      if (!updated.rowCount) return false;
      await logPlatformAction(tx, req.platformAdmin!.email, "rejected_tenant_request", updated.rows[0].university_name, body.data.reason ? `Reason: ${body.data.reason}` : undefined);
      return true;
    });
    if (!result) return res.status(404).json({ error: "not_found_or_already_reviewed" });
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
    // tenant to look at, not a cross-tenant query -- exactly the reference deck's "read-only tenant support view".
    const [team, overview, supportNotes] = await withTenant(req.params.id, async (tx) => [
      await getTeam(tx), await getOverview(tx, "30d"),
      (await tx.query(`SELECT id, note, status, created_by, created_at, resolved_at FROM tenant_support_notes ORDER BY created_at DESC`)).rows,
    ]);
    res.json({ ...base, team, overview, support_notes: supportNotes });
  } catch (err) { next(err); }
});

// An Admin's own password-change request can only be approved here -- never by a fellow tenant Admin from
// Settings > Team (that route explicitly refuses an admin-role target, see settings.ts's approvePasswordChange).
// `detail.team` above already carries password_change_requested_at/approved_at per member, so no new read
// endpoint is needed for the Super Admin UI to show which admins are waiting.
platformRouter.post("/tenants/:id/team/:userId/approve-password-change", async (req, res, next) => {
  try {
    const ok = await withTenant(req.params.id, (tx) => approvePasswordChange(tx, req.params.userId, true));
    if (!ok) return res.status(404).json({ error: "not_found" });
    const name = (await withoutTenant((tx) => tx.query(`SELECT name FROM platform_list_tenants() WHERE id = $1`, [req.params.id]))).rows[0]?.name;
    await withoutTenant((tx) => logPlatformAction(tx, req.platformAdmin!.email, "approved_admin_password_change", name));
    res.status(204).end();
  } catch (err) { next(err); }
});

const TenantStatus = z.object({ status: z.enum(["active", "suspended"]) });

platformRouter.post("/tenants/:id/status", async (req, res, next) => {
  const body = TenantStatus.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const name = (await withoutTenant((tx) => tx.query(`SELECT name FROM platform_list_tenants() WHERE id = $1`, [req.params.id]))).rows[0]?.name;
    if (!name) return res.status(404).json({ error: "not_found" });
    await withoutTenant(async (tx) => {
      await tx.query(`SELECT platform_set_tenant_status($1, $2)`, [req.params.id, body.data.status]);
      await logPlatformAction(tx, req.platformAdmin!.email, body.data.status === "suspended" ? "suspended_tenant" : "reactivated_tenant", name);
    });
    res.json({ status: body.data.status });
  } catch (err) { next(err); }
});

const Limits = z.object({ monthly_conversation_limit: z.number().int().min(0), monthly_message_limit: z.number().int().min(0) });

platformRouter.patch("/tenants/:id/limits", async (req, res, next) => {
  const body = Limits.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const before = await withTenant(req.params.id, (tx) => tx.query(`SELECT monthly_conversation_limit FROM tenant_limits`));
    if (!before.rows.length) return res.status(404).json({ error: "not_found" });
    await withTenant(req.params.id, (tx) =>
      tx.query(`UPDATE tenant_limits SET monthly_conversation_limit = $1, monthly_message_limit = $2`, [body.data.monthly_conversation_limit, body.data.monthly_message_limit]));
    const name = (await withoutTenant((tx) => tx.query(`SELECT name FROM platform_list_tenants() WHERE id = $1`, [req.params.id]))).rows[0]?.name;
    await withoutTenant((tx) => logPlatformAction(tx, req.platformAdmin!.email, "changed_usage_limit", name,
      `Monthly conversation cap ${before.rows[0].monthly_conversation_limit} → ${body.data.monthly_conversation_limit}`));
    res.status(204).end();
  } catch (err) { next(err); }
});

// The two sellable plans (PRD: "Web only" vs "Web + WhatsApp") reduce to this one flag -- whatsapp_enabled
// already existed for metering/display, this is what makes it the actual plan gate (enforced for real in
// staff.ts's POST /settings/channels/whatsapp, not just here). No separate plan table for exactly two tiers.
const Plan = z.object({ whatsapp_enabled: z.boolean() });
platformRouter.patch("/tenants/:id/plan", async (req, res, next) => {
  const body = Plan.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const updated = await withTenant(req.params.id, (tx) =>
      tx.query(`UPDATE tenant_limits SET whatsapp_enabled = $1 RETURNING whatsapp_enabled`, [body.data.whatsapp_enabled]));
    if (!updated.rowCount) return res.status(404).json({ error: "not_found" });
    const name = (await withoutTenant((tx) => tx.query(`SELECT name FROM platform_list_tenants() WHERE id = $1`, [req.params.id]))).rows[0]?.name;
    await withoutTenant((tx) => logPlatformAction(tx, req.platformAdmin!.email, "changed_plan", name,
      `Plan changed to ${body.data.whatsapp_enabled ? "Web + WhatsApp" : "Web only"}`));
    res.status(204).end();
  } catch (err) { next(err); }
});

const Billing = z.object({
  plan_price_cents: z.number().int().min(0).optional(),
  billing_cycle: z.enum(["monthly", "annual"]).optional(),
  payment_status: z.enum(["trial", "paid", "failed", "none"]).optional(),
  invoiced_outside_platform: z.boolean().optional(),
  invoice_note: z.string().trim().max(500).nullable().optional(),
});

platformRouter.patch("/tenants/:id/billing", async (req, res, next) => {
  const body = Billing.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const exists = (await withoutTenant((tx) => tx.query(`SELECT name FROM platform_list_tenants() WHERE id = $1`, [req.params.id]))).rows[0];
    if (!exists) return res.status(404).json({ error: "not_found" });
    await withTenant(req.params.id, async (tx) => {
      const current = (await tx.query(`SELECT * FROM tenant_billing`)).rows[0] as
        { plan_price_cents: number; billing_cycle: string; payment_status: string; invoiced_outside_platform: boolean; invoice_note: string | null } | undefined;
      const merged = {
        plan_price_cents: body.data.plan_price_cents ?? current?.plan_price_cents ?? 0,
        billing_cycle: body.data.billing_cycle ?? current?.billing_cycle ?? "monthly",
        payment_status: body.data.payment_status ?? current?.payment_status ?? "trial",
        invoiced_outside_platform: body.data.invoiced_outside_platform ?? current?.invoiced_outside_platform ?? false,
        invoice_note: "invoice_note" in body.data ? body.data.invoice_note ?? null : current?.invoice_note ?? null,
      };
      await tx.query(
        `INSERT INTO tenant_billing (tenant_id, plan_price_cents, billing_cycle, payment_status, invoiced_outside_platform, invoice_note, updated_at)
         VALUES (current_tenant_id(), $1,$2,$3,$4,$5, now())
         ON CONFLICT (tenant_id) DO UPDATE SET plan_price_cents=$1, billing_cycle=$2, payment_status=$3, invoiced_outside_platform=$4, invoice_note=$5, updated_at=now()`,
        [merged.plan_price_cents, merged.billing_cycle, merged.payment_status, merged.invoiced_outside_platform, merged.invoice_note]);
    });
    await withoutTenant((tx) => logPlatformAction(tx, req.platformAdmin!.email, "updated_billing", exists.name, JSON.stringify(body.data)));
    res.status(204).end();
  } catch (err) { next(err); }
});

const SupportNote = z.object({ note: z.string().trim().min(1).max(2000) });

platformRouter.post("/tenants/:id/support-notes", async (req, res, next) => {
  const body = SupportNote.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const exists = (await withoutTenant((tx) => tx.query(`SELECT 1 FROM platform_list_tenants() WHERE id = $1`, [req.params.id]))).rowCount;
    if (!exists) return res.status(404).json({ error: "not_found" });
    const row = await withTenant(req.params.id, (tx) =>
      tx.query(`INSERT INTO tenant_support_notes (tenant_id, note, created_by) VALUES (current_tenant_id(), $1, $2) RETURNING id, note, status, created_by, created_at`,
        [body.data.note, req.platformAdmin!.email]));
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
});

const NoteStatus = z.object({ status: z.enum(["open", "resolved"]) });

platformRouter.patch("/tenants/:id/support-notes/:noteId", async (req, res, next) => {
  const body = NoteStatus.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const updated = await withTenant(req.params.id, (tx) =>
      tx.query(`UPDATE tenant_support_notes SET status = $1, resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END WHERE id = $2`,
        [body.data.status, req.params.noteId]));
    if (!updated.rowCount) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- Cross-tenant support notes (Tenant Support page)
platformRouter.get("/support-notes", async (req, res, next) => {
  const status = typeof req.query.status === "string" ? req.query.status : "open";
  try {
    const tenants = (await withoutTenant((tx) => tx.query(`SELECT id, name FROM platform_list_tenants()`))).rows as { id: string; name: string }[];
    const perTenant = await Promise.all(tenants.map(async (t) => {
      const rows = (await withTenant(t.id, (tx) =>
        tx.query(`SELECT id, note, status, created_by, created_at, resolved_at FROM tenant_support_notes WHERE status = $1 ORDER BY created_at DESC`, [status]))).rows;
      return rows.map((r) => ({ ...r, tenant_id: t.id, tenant_name: t.name }));
    }));
    res.json({ notes: perTenant.flat().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- Billing overview
platformRouter.get("/billing", async (_req, res, next) => {
  try {
    const tenants = (await withoutTenant((tx) => tx.query(`SELECT * FROM platform_list_tenants()`))).rows as {
      id: string; name: string; status: string; plan_price_cents: number; billing_cycle: string; payment_status: string;
      invoiced_outside_platform: boolean; created_at: string;
    }[];
    const active = tenants.filter((t) => t.status === "active");
    const mrr = active.filter((t) => t.payment_status === "paid").reduce((sum, t) => sum + (t.billing_cycle === "annual" ? t.plan_price_cents / 12 : t.plan_price_cents), 0);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const newThisMonth = tenants.filter((t) => new Date(t.created_at) >= monthStart).length;
    const churnedThisMonth = tenants.filter((t) => t.status === "suspended").length; // best-effort: no suspension-date column to filter "this month" precisely
    const failed = tenants.filter((t) => t.payment_status === "failed");
    res.json({
      mrr_cents: Math.round(mrr), arr_cents: Math.round(mrr * 12),
      new_this_month: newThisMonth, churned_this_month: churnedThisMonth,
      failed_payments: { count: failed.length, total_cents: failed.reduce((s, t) => s + t.plan_price_cents, 0) },
      tenants,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- Usage & cost
// A documented ESTIMATE, not vendor-verified billing: Gemini's own published per-token pricing, blended input/
// output into one rate for simplicity. Never presented as an actual invoice -- see the UI copy on this page.
const ESTIMATED_COST_PER_1K_TOKENS = 0.00025; // USD, blended estimate for the Gemini model this app uses

platformRouter.get("/usage-cost", async (_req, res, next) => {
  try {
    const tenants = (await withoutTenant((tx) => tx.query(`SELECT id, name, status FROM platform_list_tenants()`))).rows as { id: string; name: string; status: string }[];
    const rows = await Promise.all(tenants.filter((t) => t.status === "active").map(async (t) => {
      const usage = await withTenant(t.id, (tx) => tx.query(
        `SELECT
           count(*) FILTER (WHERE event_type = 'conversation_started')::int AS conversations,
           count(*) FILTER (WHERE event_type = 'message_received' AND channel = 'whatsapp')::int AS whatsapp_messages
         FROM usage_events WHERE "timestamp" >= now() - interval '30 days'`));
      const tokens = await withTenant(t.id, (tx) => tx.query(
        `SELECT COALESCE(SUM((metadata->>'input_tokens')::int),0) + COALESCE(SUM((metadata->>'output_tokens')::int),0) AS n
         FROM messages WHERE role = 'assistant' AND "timestamp" >= now() - interval '30 days'`));
      const limit = await withTenant(t.id, (tx) => tx.query(`SELECT monthly_conversation_limit FROM tenant_limits`));
      const totalTokens = Number(tokens.rows[0]?.n ?? 0);
      const conversations = usage.rows[0]?.conversations ?? 0;
      return {
        tenant_id: t.id, name: t.name, conversations, whatsapp_messages: usage.rows[0]?.whatsapp_messages ?? 0, tokens: totalTokens,
        estimated_cost_cents: Math.round((totalTokens / 1000) * ESTIMATED_COST_PER_1K_TOKENS * 100),
        nearing_limit: limit.rows[0] ? conversations >= 0.9 * limit.rows[0].monthly_conversation_limit : false,
      };
    }));
    rows.sort((a, b) => b.estimated_cost_cents - a.estimated_cost_cents);
    const totals = rows.reduce((acc, r) => ({ conversations: acc.conversations + r.conversations, tokens: acc.tokens + r.tokens, cost_cents: acc.cost_cents + r.estimated_cost_cents }),
      { conversations: 0, tokens: 0, cost_cents: 0 });
    res.json({ totals, tenants: rows, note: "Estimated cost is a rough guide from published per-token pricing, not a vendor invoice." });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- Platform health
// Deliberately only reports what this app can actually measure right now (DB reachability/latency, queue depth).
// No Sentry/APM integration exists in this codebase, so uptime history and past incidents are NOT fabricated --
// the response says so plainly instead of inventing numbers, per the "report outcomes faithfully" rule.
platformRouter.get("/health", async (_req, res, next) => {
  try {
    const start = Date.now();
    let dbOk = true;
    try { await pool.query("SELECT 1"); } catch { dbOk = false; }
    const dbLatencyMs = Date.now() - start;
    const queueDepth = await withoutTenant(async (tx) => {
      try { return (await tx.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE state IN ('created','retry','active')`)).rows[0].n; }
      catch { return null; } // pgboss schema not reachable from this role/connection -- report unknown, not zero
    });
    res.json({
      database: { ok: dbOk, latency_ms: dbLatencyMs },
      queue_depth: queueDepth,
      error_tracking: { configured: false, note: "No Sentry/APM integration is wired up yet -- uptime history and incident tracking would come from that once it is." },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- Sub-processors & DPA
platformRouter.get("/sub-processors", async (_req, res, next) => {
  try { res.json({ sub_processors: (await withoutTenant((tx) => tx.query(`SELECT * FROM sub_processors ORDER BY vendor`))).rows }); } catch (err) { next(err); }
});
const SubProcessor = z.object({
  vendor: z.string().trim().min(1).max(200), purpose: z.string().trim().min(1).max(500),
  dpa_status: z.enum(["not_reviewed", "signed", "not_required"]).default("not_reviewed"),
  last_reviewed: z.string().trim().optional().nullable(), notes: z.string().trim().max(1000).optional().nullable(),
});
platformRouter.post("/sub-processors", async (req, res, next) => {
  const body = SubProcessor.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const row = await withoutTenant((tx) =>
      tx.query(`INSERT INTO sub_processors (vendor, purpose, dpa_status, last_reviewed, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [body.data.vendor, body.data.purpose, body.data.dpa_status, body.data.last_reviewed ?? null, body.data.notes ?? null]));
    await withoutTenant((tx) => logPlatformAction(tx, req.platformAdmin!.email, "added_sub_processor", body.data.vendor));
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
});
platformRouter.patch("/sub-processors/:id", async (req, res, next) => {
  const body = SubProcessor.partial().safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    const current = (await withoutTenant((tx) => tx.query(`SELECT * FROM sub_processors WHERE id = $1`, [req.params.id]))).rows[0];
    if (!current) return res.status(404).json({ error: "not_found" });
    const merged = { ...current, ...body.data };
    await withoutTenant((tx) =>
      tx.query(`UPDATE sub_processors SET vendor=$1, purpose=$2, dpa_status=$3, last_reviewed=$4, notes=$5 WHERE id=$6`,
        [merged.vendor, merged.purpose, merged.dpa_status, merged.last_reviewed, merged.notes, req.params.id]));
    await withoutTenant((tx) => logPlatformAction(tx, req.platformAdmin!.email, "updated_sub_processor", merged.vendor));
    res.status(204).end();
  } catch (err) { next(err); }
});
platformRouter.delete("/sub-processors/:id", async (req, res, next) => {
  try {
    const deleted = await withoutTenant((tx) => tx.query(`DELETE FROM sub_processors WHERE id = $1 RETURNING vendor`, [req.params.id]));
    if (!deleted.rowCount) return res.status(404).json({ error: "not_found" });
    await withoutTenant((tx) => logPlatformAction(tx, req.platformAdmin!.email, "removed_sub_processor", deleted.rows[0].vendor));
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- Platform settings (global defaults)
platformRouter.get("/settings", async (_req, res, next) => {
  try { res.json((await withoutTenant((tx) => tx.query(`SELECT default_retention_days, default_plan_limits FROM platform_settings`))).rows[0]); } catch (err) { next(err); }
});
const PlatformSettings = z.object({
  default_retention_days: z.number().int().min(1).optional(),
  default_plan_limits: z.record(z.string(), z.object({ conversations: z.number().int().min(0), messages: z.number().int().min(0) })).optional(),
});
platformRouter.patch("/settings", async (req, res, next) => {
  const body = PlatformSettings.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_request" });
  try {
    await withoutTenant(async (tx) => {
      if (body.data.default_retention_days !== undefined) await tx.query(`UPDATE platform_settings SET default_retention_days = $1`, [body.data.default_retention_days]);
      if (body.data.default_plan_limits) await tx.query(`UPDATE platform_settings SET default_plan_limits = $1::jsonb`, [JSON.stringify(body.data.default_plan_limits)]);
      await logPlatformAction(tx, req.platformAdmin!.email, "updated_global_default", "Platform", JSON.stringify(body.data));
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- Audit log
platformRouter.get("/audit-log", async (req, res, next) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const rows = await withoutTenant((tx) => tx.query(`SELECT * FROM platform_audit_log ORDER BY created_at DESC LIMIT $1`, [limit]));
    res.json({ entries: rows.rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- The platform admin's own account (read-only here;
// email/role come from platform_admins + the verified JWT, never client-editable).
platformRouter.get("/me", (req, res) => res.json({ email: req.platformAdmin!.email }));
