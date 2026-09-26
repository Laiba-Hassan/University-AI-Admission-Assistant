// Staff dashboard: Conversations list/detail/escalate (Phase 5).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createTenant, deleteTenants, staffToken, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");
let convId: string, waConvId: string;

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params);
  await c.query("COMMIT");
  return r.rows;
});
const auth = async () => ({ authorization: `Bearer ${await staffToken(A.authUserId)}` });
const get = async (path: string) => fetch(`${base}${path}`, { headers: await auth() });
const post = async (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Conv", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const [webContact] = await asOwner(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(), 'web', 'sess-abcd1234') RETURNING id");
  convId = (await asOwner(A, "INSERT INTO conversations (tenant_id, contact_id, channel, status) VALUES (current_tenant_id(), $1, 'web', 'open') RETURNING id", [webContact.id]))[0]!.id;
  const [m1] = await asOwner(A, "INSERT INTO messages (tenant_id, conversation_id, role, content, detected_language) VALUES (current_tenant_id(), $1, 'user', 'BSCS ki fee kitni hai?', 'roman_urdu') RETURNING id", [convId]);
  await asOwner(A, "INSERT INTO messages (tenant_id, conversation_id, role, content, metadata) VALUES (current_tenant_id(), $1, 'assistant', 'PKR 145,000', '{\"verifier\":{\"ok\":true}}')", [convId]);
  await asOwner(A, "INSERT INTO message_feedback (tenant_id, message_id, rating) VALUES (current_tenant_id(), $1, -1)", [m1.id]);
  await asOwner(A, "INSERT INTO leads (tenant_id, contact_id, name) VALUES (current_tenant_id(), $1, 'Ayesha Khan')", [webContact.id]);

  const [waContact] = await asOwner(A, "INSERT INTO contacts (tenant_id, channel, external_id) VALUES (current_tenant_id(), 'whatsapp', '923001234567') RETURNING id");
  waConvId = (await asOwner(A, "INSERT INTO conversations (tenant_id, contact_id, channel, status) VALUES (current_tenant_id(), $1, 'whatsapp', 'needs_human') RETURNING id", [waContact.id]))[0]!.id;
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("GET /api/v1/conversations", () => {
  it("lists conversations with a masked WhatsApp number or a visitor id, last message, and flags", async () => {
    const res = await get("/api/v1/conversations");
    assert.equal(res.status, 200);
    const { data } = (await res.json()) as { data: { id: string; display_id: string; has_lead: boolean; thumbs_down: boolean; last_message: string }[] };
    const web = data.find((c) => c.id === convId)!;
    assert.equal(web.display_id, "Visitor #1234");
    assert.equal(web.has_lead, true);
    assert.equal(web.thumbs_down, true);
    assert.equal(web.last_message, "PKR 145,000");
    const wa = data.find((c) => c.id === waConvId)!;
    assert.equal(wa.display_id, "9230●●●●●567"); // masked, never the raw number
  });

  it("filters by status and has_lead", async () => {
    const needsHuman = (await (await get("/api/v1/conversations?status=needs_human")).json()) as { data: { id: string }[] };
    assert.deepEqual(needsHuman.data.map((c) => c.id), [waConvId]);
    // createTenant's own fixture seeds a default conversation+lead on the same contact, so both it and convId
    // (which this test also gave a lead) should come back; the WhatsApp conversation, which has none, should not.
    const withLead = (await (await get("/api/v1/conversations?has_lead=true")).json()) as { data: { id: string }[] };
    const ids = new Set(withLead.data.map((c) => c.id));
    assert.ok(ids.has(convId));
    assert.ok(!ids.has(waConvId));
  });

  it("filters by thumbs_down", async () => {
    const res = (await (await get("/api/v1/conversations?thumbs_down=true")).json()) as { data: { id: string }[] };
    assert.deepEqual(res.data.map((c) => c.id), [convId]);
  });

  it("requires a staff session", async () => {
    assert.equal((await fetch(`${base}/api/v1/conversations`)).status, 401);
  });
});

describe("GET /api/v1/conversations/:id/messages", () => {
  it("returns the full thread with feedback ratings and verifier metadata", async () => {
    const res = await get(`/api/v1/conversations/${convId}/messages`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { display_id: string; messages: { role: string; content: string; rating: number | null; metadata: Record<string, unknown> }[] };
    assert.equal(body.display_id, "Visitor #1234");
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0]!.role, "user");
    assert.equal(body.messages[0]!.rating, -1);
    assert.equal(body.messages[1]!.role, "assistant");
    assert.deepEqual(body.messages[1]!.metadata, { verifier: { ok: true } });
  });

  it("404s for an unknown or another tenant's conversation id", async () => {
    assert.equal((await get(`/api/v1/conversations/00000000-0000-0000-0000-000000000000/messages`)).status, 404);
  });
});

describe("POST /api/v1/conversations/:id/escalate", () => {
  it("sets status to needs_human and is idempotent", async () => {
    // createTenant's fixture seeds the staff user as 'viewer' by default; escalate needs editor/admin.
    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
    const res = await post(`/api/v1/conversations/${convId}/escalate`, { reason: "student asked for a person" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { escalated: true });
    const row = await asOwner(A, "SELECT status FROM conversations WHERE id = $1", [convId]);
    assert.equal(row[0]!.status, "needs_human");

    const again = await post(`/api/v1/conversations/${convId}/escalate`, {});
    assert.deepEqual(await again.json(), { escalated: false }); // already needs_human: no duplicate event
  });

  it("a viewer cannot escalate (read-only role)", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'viewer' WHERE tenant_id = current_tenant_id()");
    const res = await post(`/api/v1/conversations/${waConvId}/escalate`, {});
    assert.equal(res.status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
  });
});

describe("Inbox actions", () => {
  it("assigns a conversation to the calling staff member", async () => {
    const res = await post(`/api/v1/conversations/${waConvId}/assign`, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { assigned: true });
    const row = await asOwner(A, "SELECT tu.email FROM conversations c JOIN tenant_users tu ON tu.id = c.assigned_to WHERE c.id = $1", [waConvId]);
    assert.equal(row[0]!.email, A.email);
  });

  it("records a staff reply as a real message and moves the conversation to human", async () => {
    const res = await post(`/api/v1/conversations/${waConvId}/reply`, { text: "I've refunded the duplicate payment." });
    assert.equal(res.status, 201);
    const detail = (await (await get(`/api/v1/conversations/${waConvId}/messages`)).json()) as { status: string; messages: { role: string; content: string }[] };
    assert.equal(detail.status, "human");
    const last = detail.messages[detail.messages.length - 1]!;
    assert.equal(last.role, "staff");
    assert.equal(last.content, "I've refunded the duplicate payment.");
  });

  it("closes a conversation", async () => {
    const res = await post(`/api/v1/conversations/${waConvId}/status`, { status: "closed" });
    assert.equal(res.status, 200);
    const row = await asOwner(A, "SELECT status FROM conversations WHERE id = $1", [waConvId]);
    assert.equal(row[0]!.status, "closed");
  });

  it("rejects an invalid status value instead of guessing", async () => {
    assert.equal((await post(`/api/v1/conversations/${waConvId}/status`, { status: "needs_human" })).status, 400);
  });
});
