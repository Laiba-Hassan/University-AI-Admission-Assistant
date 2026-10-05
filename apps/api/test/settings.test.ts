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

describe("Web push subscribe/unsubscribe", () => {
  it("any staff role can subscribe and unsubscribe this browser", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'viewer' WHERE tenant_id = current_tenant_id()");
    const sub = await post("/api/v1/push/subscribe", { endpoint: "https://push.example/http-ep1", keys: { p256dh: "p", auth: "a" } });
    assert.equal(sub.status, 204);
    const rows = await asOwner(A, "SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = 'https://push.example/http-ep1'");
    assert.equal(rows[0]!.n, 1);

    const unsub = await post("/api/v1/push/unsubscribe", { endpoint: "https://push.example/http-ep1" });
    assert.equal(unsub.status, 204);
    const after = await asOwner(A, "SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = 'https://push.example/http-ep1'");
    assert.equal(after[0]!.n, 0);
    await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
  });

  it("hands back null (not an error) when VAPID isn't configured, so the dashboard can hide the toggle", async () => {
    const res = await get("/api/v1/push/vapid-public-key");
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { key: string | null }).key, null);
  });
});

describe("POST /api/v1/settings/channels/whatsapp (guided manual connection)", () => {
  it("refuses to connect on the Web-only plan (tenant_limits.whatsapp_enabled defaults to false)", async () => {
    const res = await post("/api/v1/settings/channels/whatsapp", { phone_number_id: "123456789", access_token: "EAAsecrettoken1234" });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "plan_upgrade_required" });
    // GET /settings/channels must agree with the route's own refusal -- this is what the Channels page reads to
    // show an upgrade prompt instead of a connect form that would only fail once submitted.
    const channels = (await (await get("/api/v1/settings/channels")).json()) as { whatsapp_enabled: boolean };
    assert.equal(channels.whatsapp_enabled, false);
  });

  it("connects, masks the token in the response, never returns it again, and disconnect clears it, once the plan allows WhatsApp", async () => {
    await asOwner(A, "UPDATE tenant_limits SET whatsapp_enabled = true WHERE tenant_id = current_tenant_id()"); // simulates Super Admin upgrading the plan
    const res = await post("/api/v1/settings/channels/whatsapp", {
      phone_number_id: "123456789", waba_id: "waba1", display_number: "+1 555 0100", access_token: "EAAsecrettoken1234", template_name: "admissions_followup",
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { masked: string };
    assert.equal(body.masked, "••••••1234");
    assert.doesNotMatch(body.masked, /EAAsecrettoken/);

    const channels = (await (await get("/api/v1/settings/channels")).json()) as { whatsapp: { status: string; display_number: string } };
    assert.equal(channels.whatsapp.status, "active");
    assert.equal(channels.whatsapp.display_number, "+1 555 0100");
    assert.doesNotMatch(JSON.stringify(channels), /EAAsecrettoken/); // the encrypted token never leaves the server

    assert.equal((await post("/api/v1/settings/channels/whatsapp/disconnect", {})).status, 204);
    const after = (await (await get("/api/v1/settings/channels")).json()) as { whatsapp: { status: string } };
    assert.equal(after.whatsapp.status, "disconnected");
  });

  it("only an admin can connect a WhatsApp number", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
    const res = await post("/api/v1/settings/channels/whatsapp", { phone_number_id: "1", access_token: "t" });
    assert.equal(res.status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
  });
});

describe("POST /api/v1/settings/channels/widget (web widget key)", () => {
  it("is idempotent -- fixtures already gave this tenant a key, so it comes back unchanged, not a second key", async () => {
    const before = (await (await get("/api/v1/settings/channels")).json()) as { web_widget: { public_key: string } };
    const res = await post("/api/v1/settings/channels/widget", { allowed_origins: ["https://example.edu"] });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { public_key: string; allowed_origins: string[] };
    assert.equal(body.public_key, before.web_widget.public_key); // no second key created
    // allowed_origins from this POST are only used on FIRST creation -- an existing key's origins are untouched.
    assert.notDeepEqual(body.allowed_origins, ["https://example.edu"]);
  });

  it("PATCH replaces allowed_origins on the existing key", async () => {
    const res = await patch("/api/v1/settings/channels/widget", { allowed_origins: ["https://a.example", "https://b.example"] });
    assert.equal(res.status, 204);
    const channels = (await (await get("/api/v1/settings/channels")).json()) as { web_widget: { allowed_origins: string[] } };
    assert.deepEqual(channels.web_widget.allowed_origins, ["https://a.example", "https://b.example"]);
  });

  it("rotate issues a genuinely new public_key", async () => {
    const before = (await (await get("/api/v1/settings/channels")).json()) as { web_widget: { public_key: string } };
    const res = await post("/api/v1/settings/channels/widget/rotate", {});
    assert.equal(res.status, 200);
    const { public_key } = (await res.json()) as { public_key: string };
    assert.notEqual(public_key, before.web_widget.public_key);
    const after = (await (await get("/api/v1/settings/channels")).json()) as { web_widget: { public_key: string } };
    assert.equal(after.web_widget.public_key, public_key);
  });

  it("only an admin can set up or rotate the widget key", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'viewer' WHERE tenant_id = current_tenant_id()");
    assert.equal((await post("/api/v1/settings/channels/widget", { allowed_origins: [] })).status, 403);
    assert.equal((await post("/api/v1/settings/channels/widget/rotate", {})).status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
  });

  it("creates a real key for a tenant that has none yet", async () => {
    const B = await withOwner((c) => createTenant(c, "SettingsNoWidget", 1000));
    await asOwner(B, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
    await asOwner(B, "DELETE FROM widget_keys WHERE tenant_id = current_tenant_id()"); // simulate the pre-onboarding state
    const bAuth = async () => ({ authorization: `Bearer ${await staffToken(B.authUserId)}`, "content-type": "application/json" });
    const res = await fetch(`${base}/api/v1/settings/channels/widget`, { method: "POST", headers: await bAuth(), body: JSON.stringify({ allowed_origins: ["https://new-tenant.example"] }) });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { public_key: string; allowed_origins: string[] };
    assert.match(body.public_key, /^wk_[0-9a-f]{32}$/);
    assert.deepEqual(body.allowed_origins, ["https://new-tenant.example"]);
    await deleteTenants([B.id]);
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

describe("GET/PATCH /api/v1/settings/automations", () => {
  it("defaults to enabled/no webhook, sets a webhook_url, rejects a non-URL, and only an admin can change it", async () => {
    const initial = (await (await get("/api/v1/settings/automations")).json()) as { webhook_url: string | null; enabled: boolean };
    assert.deepEqual(initial, { webhook_url: null, enabled: true });

    const res = await patch("/api/v1/settings/automations", { webhook_url: "https://n8n.example/webhook/abc" });
    assert.equal(res.status, 204);
    const after1 = (await (await get("/api/v1/settings/automations")).json()) as { webhook_url: string | null };
    assert.equal(after1.webhook_url, "https://n8n.example/webhook/abc");

    assert.equal((await patch("/api/v1/settings/automations", { webhook_url: "not-a-url" })).status, 400);

    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
    assert.equal((await patch("/api/v1/settings/automations", { enabled: false })).status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
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

describe("Password change approval", () => {
  it("a non-admin's request moves through none -> pending -> approved -> none (consumed), approved by a tenant Admin", async () => {
    const viewerAuthId = (await asOwner(A, "SELECT gen_random_uuid() AS id"))[0]!.id as string;
    await asOwner(A, "INSERT INTO tenant_users (tenant_id, auth_user_id, email, role) VALUES (current_tenant_id(), $1, 'viewer-pw@settings.test', 'viewer')", [viewerAuthId]);
    const viewerHeaders = { authorization: `Bearer ${await staffToken(viewerAuthId)}` };
    const viewerGet = (path: string) => fetch(`${base}${path}`, { headers: viewerHeaders });
    const viewerPost = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { ...viewerHeaders, "content-type": "application/json" }, body: JSON.stringify(body) });

    assert.equal((await (await viewerGet("/api/v1/me")).json()).passwordChangeStatus, "none");
    assert.equal((await viewerPost("/api/v1/me/password-change-request", {})).status, 204);
    assert.equal((await (await viewerGet("/api/v1/me")).json()).passwordChangeStatus, "pending");

    const viewerId = (await asOwner(A, "SELECT id FROM tenant_users WHERE auth_user_id = $1", [viewerAuthId]))[0]!.id as string;
    assert.equal((await post(`/api/v1/settings/team/${viewerId}/approve-password-change`, {})).status, 204); // A is admin
    assert.equal((await (await viewerGet("/api/v1/me")).json()).passwordChangeStatus, "approved");

    assert.equal((await viewerPost("/api/v1/me/password-change-consumed", {})).status, 204);
    assert.equal((await (await viewerGet("/api/v1/me")).json()).passwordChangeStatus, "none");
  });

  it("an Admin's own request is NOT approvable by a fellow tenant Admin (must go through the platform)", async () => {
    const otherAdminAuthId = (await asOwner(A, "SELECT gen_random_uuid() AS id"))[0]!.id as string;
    await asOwner(A, "INSERT INTO tenant_users (tenant_id, auth_user_id, email, role) VALUES (current_tenant_id(), $1, 'other-admin-pw@settings.test', 'admin')", [otherAdminAuthId]);
    const otherAdminId = (await asOwner(A, "SELECT id FROM tenant_users WHERE auth_user_id = $1", [otherAdminAuthId]))[0]!.id as string;
    const otherAdminToken = await staffToken(otherAdminAuthId);
    await fetch(`${base}/api/v1/me/password-change-request`, { method: "POST", headers: { authorization: `Bearer ${otherAdminToken}`, "content-type": "application/json" }, body: "{}" });

    // A is also an admin in this tenant, but the tenant-level route refuses an admin-role target outright.
    const res = await post(`/api/v1/settings/team/${otherAdminId}/approve-password-change`, {});
    assert.equal(res.status, 404);
    const row = await asOwner(A, "SELECT password_change_approved_at FROM tenant_users WHERE id = $1", [otherAdminId]);
    assert.equal(row[0]!.password_change_approved_at, null);
  });

  it("GET /me no longer special-cases admins -- their own request shows pending/approved like anyone else's", async () => {
    assert.equal((await (await get("/api/v1/me")).json()).passwordChangeStatus, "none"); // A hasn't requested yet
    assert.equal((await post("/api/v1/me/password-change-request", {})).status, 204);
    assert.equal((await (await get("/api/v1/me")).json()).passwordChangeStatus, "pending");
    await asOwner(A, "UPDATE tenant_users SET password_change_requested_at = NULL, password_change_approved_at = NULL WHERE auth_user_id = $1", [A.authUserId]); // reset for other tests
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
