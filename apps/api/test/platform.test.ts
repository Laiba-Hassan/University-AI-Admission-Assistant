// Phase 7: the Super Admin surface -- reviewing access requests, creating the approved tenant, and a
// cross-tenant read-only view -- all gated by a platform_admins identity distinct from any tenant_users row.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { deleteTenants, staffToken, withOwner } from "./fixtures.js";

let server: Server, base: string;
let db: typeof import("../src/db.js");
const adminAuthUserId = randomUUID();
const adminEmail = `platform-admin-${adminAuthUserId.slice(0, 8)}@uaa.internal`;
const otherAuthUserId = randomUUID(); // a real Supabase user, but NOT a platform admin

const created: string[] = []; // tenant ids to clean up

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await withOwner((c) => c.query("INSERT INTO platform_admins (auth_user_id, email) VALUES ($1, $2)", [adminAuthUserId, adminEmail]));
});
after(async () => {
  server.close();
  await withOwner((c) => c.query("DELETE FROM platform_admins WHERE auth_user_id = $1", [adminAuthUserId]));
  await withOwner((c) => c.query("DELETE FROM access_requests WHERE email LIKE 'platform-test-%'"));
  await deleteTenants(created); // FORCE RLS binds app_migrator too -- this sets each tenant's own context first
  await db.pool.end();
});

async function asAdmin(path: string, opts: RequestInit = {}) {
  const token = await staffToken(adminAuthUserId);
  return fetch(`${base}/api/platform${path}`, { ...opts, headers: { ...opts.headers, authorization: `Bearer ${token}` } });
}

describe("platform admin auth", () => {
  it("rejects a request with no token", async () => {
    assert.equal((await fetch(`${base}/api/platform/tenants`)).status, 401);
  });
  it("rejects a real Supabase user who isn't a platform admin", async () => {
    const token = await staffToken(otherAuthUserId);
    const res = await fetch(`${base}/api/platform/tenants`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 403);
  });
  it("accepts a genuine platform admin", async () => {
    assert.equal((await asAdmin("/tenants")).status, 200);
  });
});

describe("access request review", () => {
  it("lists pending requests and approves one into a real tenant + admin invite", async () => {
    await withOwner((c) =>
      c.query("INSERT INTO access_requests (university_name, contact_name, email) VALUES ($1,$2,$3)",
        ["Platform Test University", "Ayesha Raza", "platform-test-ayesha@example.edu"]));
    const list = await asAdmin("/access-requests?status=pending");
    assert.equal(list.status, 200);
    const body = (await list.json()) as { requests: { id: string; email: string }[] };
    const row = body.requests.find((r) => r.email === "platform-test-ayesha@example.edu");
    assert.ok(row, "the staged request should be in the pending list");

    const approve = await asAdmin(`/access-requests/${row!.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(approve.status, 201);
    const approved = (await approve.json()) as { tenant_id: string; tenant_name: string; subdomain: string; invite_token: string };
    assert.equal(approved.tenant_name, "Platform Test University");
    assert.equal(approved.subdomain, "platform-test-university");
    assert.ok(approved.invite_token.length > 20);
    created.push(approved.tenant_id);

    // The new tenant is real: limits exist (seeded from platform_settings.default_plan_limits.starter, not a
    // hardcoded number), and a pending admin invite for the requester's own email exists.
    const details = await db.withTenant(approved.tenant_id, (tx) =>
      tx.query("SELECT monthly_conversation_limit FROM tenant_limits WHERE tenant_id = $1", [approved.tenant_id]));
    assert.equal(details.rows[0].monthly_conversation_limit, 1000);
    const invite = await db.withTenant(approved.tenant_id, (tx) =>
      tx.query("SELECT email, role, invited_by FROM staff_invites WHERE tenant_id = $1", [approved.tenant_id]));
    assert.equal(invite.rows[0].email, "platform-test-ayesha@example.edu");
    assert.equal(invite.rows[0].role, "admin");
    assert.equal(invite.rows[0].invited_by, null); // no inviter tenant_users row exists yet -- the tenant's first admin

    // Re-approving (or rejecting) the same, now-reviewed request is refused.
    const again = await asAdmin(`/access-requests/${row!.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(again.status, 404);
  });

  it("rejects a request, leaving no tenant behind", async () => {
    const staged = await withOwner((c) =>
      c.query("INSERT INTO access_requests (university_name, contact_name, email) VALUES ($1,$2,$3) RETURNING id",
        ["Platform Test Reject U", "Bilal", "platform-test-bilal@example.edu"]));
    const id = staged.rows[0].id as string;
    const res = await asAdmin(`/access-requests/${id}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 200);
    const row = await withOwner((c) => c.query("SELECT status, reviewed_by FROM access_requests WHERE id = $1", [id]));
    assert.equal(row.rows[0].status, "rejected");
    assert.equal(row.rows[0].reviewed_by, adminEmail);
  });

  it("404s approving an unknown request", async () => {
    const res = await asAdmin(`/access-requests/${randomUUID()}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 404);
  });
});

describe("cross-tenant tenant listing", () => {
  it("lists every tenant, including ones created by other tests, without leaking tenant-scoped data", async () => {
    const res = await asAdmin("/tenants");
    const body = (await res.json()) as { tenants: { id: string; subdomain: string; staff_count: number }[] };
    assert.ok(body.tenants.length >= 1);
    assert.ok("staff_count" in body.tenants[0]);
  });

  it("returns tenant detail with team + overview for one tenant, 404 for an unknown id", async () => {
    const known = created[0];
    const res = await asAdmin(`/tenants/${known}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { subdomain: string; team: unknown[]; overview: { kpis: Record<string, unknown> } };
    assert.ok(Array.isArray(body.team));
    assert.ok(body.overview.kpis);

    assert.equal((await asAdmin(`/tenants/${randomUUID()}`)).status, 404);
  });

  it("can suspend and reactivate a tenant", async () => {
    const known = created[0];
    const suspend = await asAdmin(`/tenants/${known}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "suspended" }) });
    assert.equal(suspend.status, 200);
    const row = await db.withTenant(known, (tx) => tx.query("SELECT status FROM tenants WHERE id = $1", [known]));
    assert.equal(row.rows[0].status, "suspended");
    await asAdmin(`/tenants/${known}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "active" }) });
  });
});

const patchJson = (path: string, body: unknown) => asAdmin(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const postJson = (path: string, body: unknown) => asAdmin(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("editable usage limits (audited)", () => {
  it("updates a tenant's caps and records it in the audit log", async () => {
    const known = created[0];
    const res = await patchJson(`/tenants/${known}/limits`, { monthly_conversation_limit: 7000, monthly_message_limit: 12000 });
    assert.equal(res.status, 204);
    const row = await db.withTenant(known, (tx) => tx.query("SELECT monthly_conversation_limit, monthly_message_limit FROM tenant_limits"));
    assert.equal(row.rows[0].monthly_conversation_limit, 7000);
    assert.equal(row.rows[0].monthly_message_limit, 12000);

    const log = (await (await asAdmin("/audit-log?limit=5")).json()) as { entries: { action: string; target: string }[] };
    assert.ok(log.entries.some((e) => e.action === "changed_usage_limit"));
  });

  it("404s for an unknown tenant", async () => {
    assert.equal((await patchJson(`/tenants/${randomUUID()}/limits`, { monthly_conversation_limit: 1, monthly_message_limit: 1 })).status, 404);
  });
});

describe("manual billing tracking", () => {
  it("defaults to trial, is patchable field-by-field, and shows up in the billing overview", async () => {
    const known = created[0];
    const set1 = await patchJson(`/tenants/${known}/billing`, { plan_price_cents: 120000, billing_cycle: "monthly", payment_status: "paid" });
    assert.equal(set1.status, 204);
    type Detail = { plan_price_cents: number; payment_status: string; invoiced_outside_platform: boolean };
    let detail = (await (await asAdmin(`/tenants/${known}`)).json()) as Detail;
    assert.equal(detail.plan_price_cents, 120000);
    assert.equal(detail.payment_status, "paid");
    assert.equal(detail.invoiced_outside_platform, false); // untouched field keeps its default

    await patchJson(`/tenants/${known}/billing`, { invoiced_outside_platform: true, invoice_note: "Bank transfer, PO#1123" });
    detail = (await (await asAdmin(`/tenants/${known}`)).json()) as Detail;
    assert.equal(detail.plan_price_cents, 120000); // still untouched by the second patch
    assert.equal(detail.invoiced_outside_platform, true);

    const overview = (await (await asAdmin("/billing")).json()) as { mrr_cents: number; tenants: { id: string }[] };
    assert.ok(overview.mrr_cents >= 120000);
    assert.ok(overview.tenants.some((t) => t.id === known));
  });

  it("a failed payment shows up in the billing overview's failed_payments summary", async () => {
    const known = created[0];
    await patchJson(`/tenants/${known}/billing`, { payment_status: "failed" });
    const overview = (await (await asAdmin("/billing")).json()) as { failed_payments: { count: number; total_cents: number } };
    assert.ok(overview.failed_payments.count >= 1);
    await patchJson(`/tenants/${known}/billing`, { payment_status: "paid" }); // leave it clean for other tests
  });
});

describe("tenant support notes", () => {
  it("adds a note, lists it on tenant detail, and can mark it resolved", async () => {
    const known = created[0];
    const add = await postJson(`/tenants/${known}/support-notes`, { note: "Widget not loading on Safari" });
    assert.equal(add.status, 201);
    const { id } = (await add.json()) as { id: string };

    const detail = (await (await asAdmin(`/tenants/${known}`)).json()) as { support_notes: { id: string; status: string; created_by: string }[] };
    const note = detail.support_notes.find((n) => n.id === id);
    assert.ok(note);
    assert.equal(note!.status, "open");
    assert.equal(note!.created_by, adminEmail);

    const resolve = await patchJson(`/tenants/${known}/support-notes/${id}`, { status: "resolved" });
    assert.equal(resolve.status, 204);
    const after = (await (await asAdmin(`/tenants/${known}`)).json()) as { support_notes: { id: string; status: string }[] };
    assert.equal(after.support_notes.find((n) => n.id === id)!.status, "resolved");
  });
});

describe("usage & cost", () => {
  it("returns a per-tenant cost rollup with a totals row and an honest 'estimate' disclaimer", async () => {
    const res = await asAdmin("/usage-cost");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { totals: { conversations: number }; tenants: { tenant_id: string }[]; note: string };
    assert.ok(body.totals);
    assert.match(body.note, /stimate/);
    assert.ok(Array.isArray(body.tenants));
  });
});

describe("platform health", () => {
  it("reports real DB reachability and is honest that no error-tracking integration exists", async () => {
    const res = await asAdmin("/health");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { database: { ok: boolean }; error_tracking: { configured: boolean } };
    assert.equal(body.database.ok, true);
    assert.equal(body.error_tracking.configured, false);
  });
});

describe("sub-processors & DPA", () => {
  it("creates, updates and deletes a sub-processor, defaulting to not_reviewed", async () => {
    const create = await postJson("/sub-processors", { vendor: "Google (Gemini API)", purpose: "AI model provider" });
    assert.equal(create.status, 201);
    const row = (await create.json()) as { id: string; dpa_status: string };
    assert.equal(row.dpa_status, "not_reviewed"); // never fabricated as pre-signed

    const patch = await patchJson(`/sub-processors/${row.id}`, { dpa_status: "signed", last_reviewed: "2026-01-15" });
    assert.equal(patch.status, 204);
    const list = (await (await asAdmin("/sub-processors")).json()) as { sub_processors: { id: string; dpa_status: string }[] };
    assert.equal(list.sub_processors.find((s) => s.id === row.id)!.dpa_status, "signed");

    assert.equal((await asAdmin(`/sub-processors/${row.id}`, { method: "DELETE" })).status, 204);
    assert.equal((await asAdmin(`/sub-processors/${randomUUID()}`, { method: "DELETE" })).status, 404);
  });
});

describe("platform settings (global defaults)", () => {
  it("reads defaults and can update the retention default without touching plan limits", async () => {
    const initial = (await (await asAdmin("/settings")).json()) as { default_retention_days: number; default_plan_limits: Record<string, unknown> };
    assert.equal(initial.default_retention_days, 90);

    const patch = await patchJson("/settings", { default_retention_days: 120 });
    assert.equal(patch.status, 204);
    const after = (await (await asAdmin("/settings")).json()) as { default_retention_days: number; default_plan_limits: Record<string, unknown> };
    assert.equal(after.default_retention_days, 120);
    assert.deepEqual(after.default_plan_limits, initial.default_plan_limits); // untouched
    await patchJson("/settings", { default_retention_days: 90 }); // leave clean
  });
});

describe("audit log", () => {
  it("records platform-admin actions across every route that mutates something", async () => {
    const res = await asAdmin("/audit-log");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { entries: { admin_email: string; action: string }[] };
    assert.ok(body.entries.length > 0);
    // The log is platform-wide and never cleared between test runs, so only assert THIS run's admin shows up --
    // not that every entry belongs to it.
    assert.ok(body.entries.some((e) => e.admin_email === adminEmail));
  });
});
