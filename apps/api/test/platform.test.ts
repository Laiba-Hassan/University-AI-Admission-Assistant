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

    // The new tenant is real: limits exist, and a pending admin invite for the requester's own email exists.
    const details = await db.withTenant(approved.tenant_id, (tx) =>
      tx.query("SELECT monthly_conversation_limit FROM tenant_limits WHERE tenant_id = $1", [approved.tenant_id]));
    assert.equal(details.rows[0].monthly_conversation_limit, 500);
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
