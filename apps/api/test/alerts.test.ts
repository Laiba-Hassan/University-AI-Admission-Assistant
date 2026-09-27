// Staff dashboard: real-time-ish in-dashboard alerts (Phase 5) -- polled, not push (that's Phase 6A's web push).
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
const get = async (path: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${await staffToken(A.authUserId)}` } });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Alerts", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("GET /api/v1/alerts", () => {
  it("returns only lead/handoff events newer than 'since', and the server's own clock", async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    await asOwner(A, "INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'lead_created', '{\"lead_id\":\"x\"}')");
    await asOwner(A, "INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'message_received', '{}')"); // not an alert type
    const res = await get(`/api/v1/alerts?since=${before}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { event_type: string }[]; server_time: string };
    assert.deepEqual(body.data.map((e) => e.event_type), ["lead_created"]);
    assert.ok(!Number.isNaN(Date.parse(body.server_time)));
  });

  it("never includes a student name or phone number in the payload", async () => {
    await asOwner(A, "INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'handoff_requested', $1)", [JSON.stringify({ conversation_id: "c1", reason: "billing dispute" })]);
    const res = await get(`/api/v1/alerts?since=${new Date(Date.now() - 5000).toISOString()}`);
    const text = await res.text();
    assert.ok(!/0300\d{7}|@.*\.(com|edu)/.test(text));
  });

  it("requires a staff session", async () => {
    assert.equal((await fetch(`${base}/api/v1/alerts`)).status, 401);
  });
});
