// Phase 5: staff invite send (settings.ts, already tested in settings.test.ts) + accept (this file). Accepting
// needs a real Supabase-verified auth user but deliberately no prior tenant membership.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});
const post = async (path: string, body: unknown, authUserId?: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authUserId ? { authorization: `Bearer ${await staffToken(authUserId)}` } : {}) },
    body: JSON.stringify(body),
  });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Invites", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("Invite accept flow (send -> accept)", () => {
  it("a freshly-invited person, with no prior membership, joins as the invited role", async () => {
    const inviteRes = await post("/api/v1/settings/team/invite", { email: "new-hire@northbridge.edu.pk", role: "editor" }, A.authUserId);
    assert.equal(inviteRes.status, 201);
    const { invite_token } = (await inviteRes.json()) as { invite_token: string };

    const newAuthUserId = randomUUID();
    const acceptRes = await post("/api/public/invites/accept", { token: invite_token }, newAuthUserId);
    assert.equal(acceptRes.status, 200);
    const body = (await acceptRes.json()) as { tenantId: string; tenantName: string; role: string };
    assert.equal(body.tenantId, A.id);
    assert.equal(body.role, "editor");

    const row = await asOwner(A, "SELECT role, auth_user_id FROM tenant_users WHERE email = 'new-hire@northbridge.edu.pk'");
    assert.equal(row[0]!.role, "editor");
    assert.equal(row[0]!.auth_user_id, newAuthUserId);
    const invite = await asOwner(A, "SELECT accepted_at FROM staff_invites WHERE email = 'new-hire@northbridge.edu.pk'");
    assert.ok(invite[0]!.accepted_at != null);
  });

  it("rejects an already-accepted invite (single use)", async () => {
    const inviteRes = await post("/api/v1/settings/team/invite", { email: "reuse-test@northbridge.edu.pk", role: "viewer" }, A.authUserId);
    const { invite_token } = (await inviteRes.json()) as { invite_token: string };
    const firstUser = randomUUID(), secondUser = randomUUID();
    assert.equal((await post("/api/public/invites/accept", { token: invite_token }, firstUser)).status, 200);
    assert.equal((await post("/api/public/invites/accept", { token: invite_token }, secondUser)).status, 404);
  });

  it("rejects a bogus token, and requires a real auth session", async () => {
    assert.equal((await post("/api/public/invites/accept", { token: "x".repeat(40) }, randomUUID())).status, 404);
    assert.equal((await post("/api/public/invites/accept", { token: "x".repeat(40) })).status, 401); // no auth header at all
  });
});
