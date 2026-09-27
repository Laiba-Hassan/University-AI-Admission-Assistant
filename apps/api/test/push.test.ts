// Web push (PRD 6A): a subscription is saved encrypted, a tenant-scoped send reaches every subscribed device
// with a minimal alert (never the student's name or phone number), a gone/expired subscription is cleaned up,
// and the cross-tenant event_outbox claim only ever pushes lead_created/handoff_requested events, once each.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, B: Fixture;
let db: typeof import("../src/db.js");
let push: typeof import("../src/push.js");

const ownerQ = (f: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [f.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});
async function staffRowId(f: Fixture) {
  return (await ownerQ(f, "SELECT id FROM tenant_users WHERE tenant_id = current_tenant_id() LIMIT 1"))[0]!.id as string;
}

before(async () => {
  db = await import("../src/db.js");
  push = await import("../src/push.js");
  [A, B] = await withOwner(async (c) => [await createTenant(c, "PushAlpha", 1), await createTenant(c, "PushBeta", 2)]);
});
after(async () => { await deleteTenants([A.id, B.id]); await db.pool.end(); });

describe("push subscriptions", () => {
  it("saves a subscription's keys encrypted, and a send reaches it with a minimal payload", async () => {
    const staffId = await staffRowId(A);
    await db.withTenant(A.id, (tx) => push.savePushSubscription(tx, staffId, { endpoint: "https://push.example/ep1", keys: { p256dh: "p256dh-key", auth: "auth-key" } }));

    const raw = await ownerQ(A, "SELECT keys FROM push_subscriptions WHERE endpoint = 'https://push.example/ep1'");
    assert.doesNotMatch(raw[0]!.keys as string, /p256dh-key/); // encrypted at rest, not the plaintext key material

    const sent: { endpoint: string; payload: string }[] = [];
    const fakeSend: import("../src/push.js").PushSendFn = async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload }); };
    const result = await db.withTenant(A.id, (tx) => push.sendPushToTenant(tx, { title: "New lead captured", body: "A student left their contact details.", url: "/leads" }, fakeSend));
    assert.equal(result.sent, 1);
    assert.equal(sent[0]!.endpoint, "https://push.example/ep1");
    const payload = JSON.parse(sent[0]!.payload) as { title: string; body: string };
    assert.doesNotMatch(payload.title + payload.body, /[A-Za-z]+ [A-Za-z]+@|\+?\d{7,}/); // no name-like or phone-like content
  });

  it("removes a subscription that the push service reports gone (410), and never sends to another tenant's device", async () => {
    const staffId = await staffRowId(B);
    await db.withTenant(B.id, (tx) => push.savePushSubscription(tx, staffId, { endpoint: "https://push.example/ep-gone", keys: { p256dh: "x", auth: "y" } }));

    const fakeSend: import("../src/push.js").PushSendFn = async () => { const e = new Error("gone") as Error & { statusCode: number }; e.statusCode = 410; throw e; };
    const result = await db.withTenant(B.id, (tx) => push.sendPushToTenant(tx, { title: "t", body: "b", url: "/" }, fakeSend));
    assert.equal(result.sent, 0);

    const rows = await ownerQ(B, "SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = 'https://push.example/ep-gone'");
    assert.equal(rows[0]!.n, 0); // cleaned up, not retried forever

    // A's earlier subscription is untouched by anything done under B's tenant context.
    const aRows = await ownerQ(A, "SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = 'https://push.example/ep1'");
    assert.equal(aRows[0]!.n, 1);
  });

  it("unsubscribe deletes the row", async () => {
    await db.withTenant(A.id, (tx) => push.deletePushSubscription(tx, "https://push.example/ep1"));
    const rows = await ownerQ(A, "SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = 'https://push.example/ep1'");
    assert.equal(rows[0]!.n, 0);
  });
});

describe("processPendingPushEvents (cross-tenant claim)", () => {
  it("pushes a lead_created and a handoff_requested event once each, and ignores unrelated event types", async () => {
    const staffId = await staffRowId(A);
    await db.withTenant(A.id, (tx) => push.savePushSubscription(tx, staffId, { endpoint: "https://push.example/ep-claim", keys: { p256dh: "x", auth: "y" } }));
    await ownerQ(A, "INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'lead_created', '{}')");
    await ownerQ(A, "INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'handoff_requested', '{}')");
    await ownerQ(A, "INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'unanswered_logged', '{}')");

    const sent: string[] = [];
    const fakeSend: import("../src/push.js").PushSendFn = async (_sub, payload) => { sent.push((JSON.parse(payload) as { title: string }).title); };
    await push.processPendingPushEvents(fakeSend);

    assert.equal(sent.length, 2);
    assert.ok(sent.includes("New lead captured"));
    assert.ok(sent.includes("A student needs a person"));

    // Claimed events are marked done -- a second run doesn't re-push them.
    sent.length = 0;
    await push.processPendingPushEvents(fakeSend);
    assert.equal(sent.length, 0);
  });
});
