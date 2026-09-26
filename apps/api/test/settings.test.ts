// Staff dashboard: Settings (channels, branding, messages, retention, team) -- Phase 5.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});
const auth = async () => ({ authorization: `Bearer ${await staffToken(A.authUserId)}` });
const get = async (path: string) => fetch(`${base}${path}`, { headers: await auth() });
const patch = async (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "PATCH", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(body) });
const post = async (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Settings", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("GET /api/v1/settings/usage", () => {
  it("reflects the same monthly counting the live limit enforcement uses", async () => {
    await asOwner(A, "INSERT INTO usage_events (tenant_id, event_type) VALUES (current_tenant_id(), 'conversation_started')");
    const res = await get("/api/v1/settings/usage");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { conversations_used: number; monthly_conversation_limit: number };
    assert.equal(body.conversations_used, 1);
    assert.equal(body.monthly_conversation_limit, 500); // tenant_limits default
  });
});

describe("GET/PATCH /api/v1/settings/branding", () => {
  it("reads and partially updates branding without clobbering other keys", async () => {
    await asOwner(A, "UPDATE tenants SET branding = '{\"primary\":\"#0B3D91\",\"accent\":\"#F2A900\"}'");
    const res1 = await patch("/api/v1/settings/branding", { branding: { accent: "#FF0000" } });
    assert.equal(res1.status, 204);
    const row = await asOwner(A, "SELECT branding FROM tenants");
    assert.deepEqual(row[0]!.branding, { primary: "#0B3D91", accent: "#FF0000" });
  });
});

describe("GET/PATCH /api/v1/settings/messages", () => {
  it("updates one localized message without touching the others", async () => {
    const res = await patch("/api/v1/settings/messages", { key: "welcome", language: "english", text: "Hi there!" });
    assert.equal(res.status, 204);
    const { data } = (await (await get("/api/v1/settings/messages")).json()) as { data: { key: string; language: string; text: string }[] };
    assert.equal(data.find((m) => m.key === "welcome" && m.language === "english")!.text, "Hi there!");
  });
});

describe("Team + invite", () => {
  it("lists the team and invites a new staff member with a one-time token", async () => {
    const list = (await (await get("/api/v1/settings/team")).json()) as { data: { email: string; role: string }[] };
    assert.ok(list.data.some((u) => u.email === A.email));

    const res = await post("/api/v1/settings/team/invite", { email: "new-staff@northbridge.edu.pk", role: "viewer" });
    assert.equal(res.status, 201);
    const { invite_token } = (await res.json()) as { invite_token: string };
    assert.ok(invite_token.length >= 32);
    const invite = await asOwner(A, "SELECT email, role, token_hash FROM staff_invites WHERE email = $1", ["new-staff@northbridge.edu.pk"]);
    assert.equal(invite[0]!.role, "viewer");
    assert.notEqual(invite[0]!.token_hash, invite_token); // only the hash is stored, never the raw token
  });

  it("only an admin can invite staff", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
    assert.equal((await post("/api/v1/settings/team/invite", { email: "x@y.com", role: "viewer" })).status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
  });
});

describe("Retention", () => {
  it("reads and updates the retention window", async () => {
    const res = await patch("/api/v1/settings/retention", { retention_days: 90 });
    assert.equal(res.status, 204);
    const got = (await (await get("/api/v1/settings/retention")).json()) as { retention_days: number };
    assert.equal(got.retention_days, 90);
  });
  it("rejects an out-of-range value", async () => {
    assert.equal((await patch("/api/v1/settings/retention", { retention_days: 0 })).status, 400);
  });
});
