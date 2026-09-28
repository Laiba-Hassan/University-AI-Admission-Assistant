// Phase 7: the onboarding wizard's status is derived from real data (approved programs/fees, branding actually
// set, a widget key existing), not a separately-tracked checklist -- only "completed" is genuinely stateful.
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
const post = async (path: string) => fetch(`${base}${path}`, { method: "POST", headers: await auth() });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Onboarding", 1000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("GET /api/v1/onboarding/status", () => {
  it("reflects real fixture data: knowledge and channels done (fixtures seed both), branding not (no welcome_message set)", async () => {
    const res = await get("/api/v1/onboarding/status");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { knowledge_done: boolean; branding_done: boolean; channels_done: boolean; completed: boolean; widget_key: string | null };
    assert.equal(body.knowledge_done, true); // fixtures create an approved program + fee item
    assert.equal(body.channels_done, true); // fixtures create a widget key
    assert.equal(body.widget_key, A.widgetKey);
    assert.equal(body.branding_done, false); // fixtures never set tenants.branding/welcome_message
    assert.equal(body.completed, false);
  });

  it("branding_done flips true once both a primary color and a welcome message are set", async () => {
    await asOwner(A, `UPDATE tenants SET branding = '{"primary":"#123456"}', welcome_message = 'Hi there'`);
    const body = (await (await get("/api/v1/onboarding/status")).json()) as { branding_done: boolean };
    assert.equal(body.branding_done, true);
  });

  it("knowledge_done is false for a tenant with no approved programs or fees", async () => {
    const B = await withOwner((c) => createTenant(c, "OnboardingEmpty", 1));
    await asOwner(B, "DELETE FROM fee_items WHERE tenant_id = current_tenant_id()");
    await asOwner(B, "DELETE FROM programs WHERE tenant_id = current_tenant_id()");
    const bToken = await staffToken(B.authUserId);
    const res = await fetch(`${base}/api/v1/onboarding/status`, { headers: { authorization: `Bearer ${bToken}` } });
    const body = (await res.json()) as { knowledge_done: boolean };
    assert.equal(body.knowledge_done, false);
    await deleteTenants([B.id]);
  });
});

describe("POST /api/v1/onboarding/complete", () => {
  it("marks onboarding complete, is idempotent, and only an admin can call it", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
    assert.equal((await post("/api/v1/onboarding/complete")).status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");

    assert.equal((await post("/api/v1/onboarding/complete")).status, 204);
    const body = (await (await get("/api/v1/onboarding/status")).json()) as { completed: boolean; completed_at: string };
    assert.equal(body.completed, true);
    assert.ok(body.completed_at);

    const firstCompletedAt = body.completed_at;
    await post("/api/v1/onboarding/complete"); // calling again doesn't move the timestamp
    const again = (await (await get("/api/v1/onboarding/status")).json()) as { completed_at: string };
    assert.equal(again.completed_at, firstCompletedAt);
  });
});
