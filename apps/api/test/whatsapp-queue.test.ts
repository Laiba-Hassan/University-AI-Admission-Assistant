// Tenant routing by phone_number_id, webhook signature verification, and the pg-boss queue running as app_queue.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { createTenant, deleteTenants, withOwner, WA_SECRET, type Fixture } from "./fixtures.js";

let A: Fixture, B: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");
const queued: { queue: string; data: { tenantId: string } & Record<string, unknown> }[] = [];

const payload = (phoneNumberId: string) => JSON.stringify({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: "wamid.1", type: "text", text: { body: "hi" } }] } }] }],
});
const sign = (body: string, secret = WA_SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const post = (body: string, signature?: string) =>
  fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) }, body });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  [A, B] = await withOwner(async (c) => [await createTenant(c, "Alpha", 1), await createTenant(c, "Beta", 2)]);
  server = createApp(async (queue, data) => { queued.push({ queue, data }); return "job"; }).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { server.close(); await deleteTenants([A.id, B.id]); await db.pool.end(); });

describe("WhatsApp webhook", () => {
  it("routes a signed message to the tenant that owns the receiving number", async () => {
    queued.length = 0;
    const [bodyA, bodyB] = [payload(A.phoneNumberId), payload(B.phoneNumberId)];
    assert.equal((await post(bodyA, sign(bodyA))).status, 200);
    assert.equal((await post(bodyB, sign(bodyB))).status, 200);
    assert.deepEqual(queued.map((q) => q.data.tenantId), [A.id, B.id]);
  });
  it("rejects a missing signature and stores nothing", async () => {
    queued.length = 0;
    assert.equal((await post(payload(A.phoneNumberId))).status, 401);
    assert.equal(queued.length, 0);
  });
  it("rejects a signature made with the wrong secret, or over a different body", async () => {
    queued.length = 0;
    const body = payload(A.phoneNumberId);
    assert.equal((await post(body, sign(body, "wrong-secret"))).status, 401);
    assert.equal((await post(body, sign(payload(B.phoneNumberId)))).status, 401);
    assert.equal(queued.length, 0);
  });
  it("acknowledges but ignores a number that belongs to no tenant", async () => {
    queued.length = 0;
    const body = payload("unknown-number");
    assert.equal((await post(body, sign(body))).status, 200);
    assert.equal(queued.length, 0);
  });
  it("does not route to a suspended tenant", async () => {
    await withOwner(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [B.id]);
      await c.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [B.id]);
      await c.query("COMMIT");
    });
    queued.length = 0;
    const body = payload(B.phoneNumberId);
    await post(body, sign(body));
    assert.equal(queued.length, 0);
  });
});

describe("job queue (pg-boss)", () => {
  it("starts as the queue role and processes a tenant-scoped job", async () => {
    const { startQueue, QUEUES } = await import("../src/queue.js");
    const queue = await startQueue();
    try {
      const id = await queue.enqueue(QUEUES.whatsappInbound, { tenantId: A.id, change: {} });
      assert.ok(id);
      let state = "";
      for (let i = 0; i < 40 && state !== "completed"; i++) {
        await new Promise((r) => setTimeout(r, 250));
        state = (await queue.boss.getJobById(QUEUES.whatsappInbound, id!))?.state ?? "";
      }
      assert.equal(state, "completed");
    } finally { await queue.stop(); }
  });
});
