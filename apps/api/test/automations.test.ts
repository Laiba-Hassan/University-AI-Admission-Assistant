// Phase 7: n8n-style automation webhooks -- per-tenant settings, delivering every event_outbox event (not just
// the two push cares about) exactly once via its own webhook_delivered_at claim, limit-warning dedup, and the
// daily usage report generator's own once-per-day dedup.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, B: Fixture;
let db: typeof import("../src/db.js");
let automations: typeof import("../src/automations.js");

before(async () => {
  db = await import("../src/db.js");
  automations = await import("../src/automations.js");
  [A, B] = await withOwner(async (c) => [await createTenant(c, "AutoAlpha", 1), await createTenant(c, "AutoBeta", 2)]);
});
after(async () => { await deleteTenants([A.id, B.id]); await db.pool.end(); });

describe("automation settings", () => {
  it("defaults to enabled with no webhook, then can be set and partially patched", async () => {
    const initial = await db.withTenant(A.id, automations.getAutomationSettings);
    assert.deepEqual(initial, { webhook_url: null, enabled: true });

    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { webhook_url: "https://hooks.example/a" }));
    let after1 = await db.withTenant(A.id, automations.getAutomationSettings);
    assert.deepEqual(after1, { webhook_url: "https://hooks.example/a", enabled: true }); // enabled untouched

    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { enabled: false }));
    after1 = await db.withTenant(A.id, automations.getAutomationSettings);
    assert.deepEqual(after1, { webhook_url: "https://hooks.example/a", enabled: false }); // url untouched

    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { webhook_url: null }));
    after1 = await db.withTenant(A.id, automations.getAutomationSettings);
    assert.equal(after1.webhook_url, null); // explicit null actually clears it
  });

  it("sendTestAutomationEvent: fails fast with no webhook configured, succeeds/fails by the injected send's result", async () => {
    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { webhook_url: null }));
    assert.deepEqual(await db.withTenant(A.id, (tx) => automations.sendTestAutomationEvent(tx, async () => ({ ok: true, status: 200 }))), { ok: false });

    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { webhook_url: "https://hooks.example/test", enabled: true }));
    const calls: { url: string; body: string }[] = [];
    const fakeSend: import("../src/automations.js").WebhookSendFn = async (url, body) => { calls.push({ url, body }); return { ok: true, status: 200 }; };
    assert.deepEqual(await db.withTenant(A.id, (tx) => automations.sendTestAutomationEvent(tx, fakeSend)), { ok: true });
    assert.equal(calls[0]!.url, "https://hooks.example/test");
    assert.equal((JSON.parse(calls[0]!.body) as { event_type: string }).event_type, "test");

    assert.deepEqual(await db.withTenant(A.id, (tx) => automations.sendTestAutomationEvent(tx, async () => ({ ok: false, status: 500 }))), { ok: false });
    assert.deepEqual(await db.withTenant(A.id, (tx) => automations.sendTestAutomationEvent(tx, async () => { throw new Error("timeout"); })), { ok: false });
  });
});

describe("processPendingAutomationEvents", () => {
  it("delivers a pending event to the tenant's own webhook and marks it claimed, skipping a tenant with none configured", async () => {
    // A's settings carry over from the "automation settings" describe above (last state there: enabled=false,
    // webhook_url=null) -- set both explicitly here rather than relying on leftover state from another block.
    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { webhook_url: "https://hooks.example/alpha-leads", enabled: true }));
    await db.withTenant(A.id, (tx) => tx.query(`INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'lead_created', $1)`, [JSON.stringify({ lead_id: "l1" })]));
    await db.withTenant(B.id, (tx) => tx.query(`INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'lead_created', $1)`, [JSON.stringify({ lead_id: "l2" })])); // B has no webhook configured

    const calls: { url: string; body: string }[] = [];
    const fakeSend: import("../src/automations.js").WebhookSendFn = async (url, body) => { calls.push({ url, body }); return { ok: true, status: 200 }; };
    const result = await automations.processPendingAutomationEvents(fakeSend, 10);
    assert.equal(result.claimed, 2); // both tenants' events are claimed (marked webhook_delivered_at)...
    assert.equal(result.delivered, 1); // ...but only A's is actually POSTed, since B has no webhook_url

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://hooks.example/alpha-leads");
    const body = JSON.parse(calls[0]!.body) as { event_type: string; payload: { lead_id: string }; tenant_id: string };
    assert.equal(body.event_type, "lead_created");
    assert.equal(body.payload.lead_id, "l1");
    assert.equal(body.tenant_id, A.id);

    // Draining again claims nothing new -- both events were already marked delivered above.
    const again = await automations.processPendingAutomationEvents(fakeSend, 10);
    assert.equal(again.claimed, 0);
  });

  it("does not deliver when disabled even with a webhook_url set", async () => {
    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { webhook_url: "https://hooks.example/alpha-off", enabled: false }));
    await db.withTenant(A.id, (tx) => tx.query(`INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'unanswered_logged', '{}')`));
    const calls: unknown[] = [];
    const result = await automations.processPendingAutomationEvents(async (u, b) => { calls.push({ u, b }); return { ok: true, status: 200 }; }, 10);
    assert.equal(calls.length, 0);
    assert.ok(result.claimed >= 1);
    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { enabled: true }));
  });

  it("logs and continues past a non-2xx response or a throwing send, instead of losing later events", async () => {
    await db.withTenant(A.id, (tx) => automations.setAutomationSettings(tx, { webhook_url: "https://hooks.example/alpha-flaky", enabled: true }));
    await db.withTenant(A.id, (tx) => tx.query(`INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'handoff_requested', '{}')`));
    await db.withTenant(A.id, (tx) => tx.query(`INSERT INTO event_outbox (tenant_id, event_type, payload) VALUES (current_tenant_id(), 'handoff_requested', '{}')`));
    let n = 0;
    const flaky: import("../src/automations.js").WebhookSendFn = async () => { n++; if (n === 1) throw new Error("ECONNREFUSED"); return { ok: false, status: 500 }; };
    const result = await automations.processPendingAutomationEvents(flaky, 10);
    assert.equal(n, 2); // the throw on the first event didn't stop the second from being attempted
    assert.equal(result.delivered, 0); // neither counted as delivered (one threw, one was a 500)
  });
});

describe("maybeEmitLimitWarning", () => {
  it("fires once per limit type per calendar month, not on every subsequent block", async () => {
    await db.withTenant(A.id, (tx) => automations.maybeEmitLimitWarning(tx, "monthly_conversation"));
    await db.withTenant(A.id, (tx) => automations.maybeEmitLimitWarning(tx, "monthly_conversation"));
    await db.withTenant(A.id, (tx) => automations.maybeEmitLimitWarning(tx, "monthly_message")); // a different limit type: its own event
    const rows = await db.withTenant(A.id, (tx) => tx.query(`SELECT payload->>'limit_type' AS t FROM event_outbox WHERE event_type = 'limit_warning' ORDER BY created_at`));
    assert.deepEqual(rows.rows.map((r: { t: string }) => r.t), ["monthly_conversation", "monthly_message"]);
  });
});

describe("generateDailyUsageReports", () => {
  it("stages one daily_usage_report event per active tenant, and does not double up if run again the same day", async () => {
    await db.withTenant(A.id, (tx) => tx.query(`INSERT INTO usage_events (tenant_id, event_type) VALUES (current_tenant_id(), 'conversation_started')`));
    await db.withTenant(A.id, (tx) => tx.query(`INSERT INTO usage_events (tenant_id, event_type) VALUES (current_tenant_id(), 'message_received')`));

    const first = await automations.generateDailyUsageReports();
    assert.ok(first.created >= 1);
    const again = await automations.generateDailyUsageReports();
    assert.equal(again.created, 0); // same calendar day: nothing new staged

    const rows = await db.withTenant(A.id, (tx) => tx.query(`SELECT payload FROM event_outbox WHERE event_type = 'daily_usage_report'`));
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].payload.conversations, 1);
    assert.equal(rows.rows[0].payload.messages, 1);
  });
});
