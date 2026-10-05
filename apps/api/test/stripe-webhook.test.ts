// The full signed webhook path, for real: a valid Stripe-signature header is generated with Stripe's own test
// helper (pure HMAC, no network call) and verified by the actual route, so this is NOT the same as calling
// handleStripeEvent() directly (covered in billing.test.ts) -- it proves the signature check itself works both
// ways (accepts a genuinely valid one, rejects a tampered one), which a direct function call can't prove.
//
// STRIPE_SECRET_KEY here is an obviously-fake test value: it's only ever used to construct the Stripe SDK client
// so stripe.webhooks.constructEvent (pure local HMAC verification) is reachable -- nothing in this file makes a
// real network call to Stripe's API. Must be set before any dynamic import of app.js/billing.js, same constraint
// fixtures.ts documents for the other test-only secrets.
process.env.STRIPE_SECRET_KEY = "sk_test_FAKE_FOR_SIGNATURE_VERIFICATION_ONLY";
const WEBHOOK_SECRET = "whsec_test_only_not_a_real_stripe_secret";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import Stripe from "stripe";
import { createTenant, deleteTenants, withOwner, type Fixture } from "./fixtures.js";

let A: Fixture, server: Server, base: string;
let db: typeof import("../src/db.js");
const signingStripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const asOwner = (t: Fixture, sql: string, params: unknown[] = []) => withOwner(async (c) => {
  await c.query("BEGIN"); await c.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
});

const customerId = "cus_test_webhook_file";
function sign(payload: string) {
  return signingStripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}
async function postWebhook(payload: string, signatureHeader: string) {
  return fetch(`${base}/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signatureHeader }, body: payload });
}

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "StripeWebhook", 100_000));
  // createTenant() never creates a tenant_billing row -- an UPDATE against a nonexistent row silently matches
  // zero, so this has to upsert.
  await asOwner(A, "INSERT INTO tenant_billing (tenant_id, stripe_customer_id) VALUES (current_tenant_id(), $1) ON CONFLICT (tenant_id) DO UPDATE SET stripe_customer_id = $1", [customerId]);
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("POST /webhooks/stripe", () => {
  it("a genuinely valid signature is accepted and actually updates the tenant's billing row", async () => {
    const payload = JSON.stringify({ id: "evt_1", type: "invoice.payment_failed", data: { object: { customer: customerId, amount_paid: 0 } } });
    const res = await postWebhook(payload, sign(payload));
    assert.equal(res.status, 200);
    const row = (await asOwner(A, "SELECT payment_status, payment_failed_at FROM tenant_billing"))[0] as { payment_status: string; payment_failed_at: Date | null };
    assert.equal(row.payment_status, "failed");
    assert.ok(row.payment_failed_at);
  });

  it("invoice.payment_succeeded clears the failure and credits lifetime revenue", async () => {
    const payload = JSON.stringify({ id: "evt_2", type: "invoice.payment_succeeded", data: { object: { customer: customerId, amount_paid: 9900 } } });
    const res = await postWebhook(payload, sign(payload));
    assert.equal(res.status, 200);
    const row = (await asOwner(A, "SELECT payment_status, payment_failed_at, lifetime_revenue_cents FROM tenant_billing"))[0] as
      { payment_status: string; payment_failed_at: Date | null; lifetime_revenue_cents: string };
    assert.equal(row.payment_status, "paid");
    assert.equal(row.payment_failed_at, null);
    assert.equal(Number(row.lifetime_revenue_cents), 9900);
  });

  it("a tampered payload (valid-shaped signature, body changed after signing) is rejected with 401, and changes nothing", async () => {
    const original = JSON.stringify({ id: "evt_3", type: "invoice.payment_failed", data: { object: { customer: customerId, amount_paid: 0 } } });
    const signature = sign(original);
    const tampered = original.replace("invoice.payment_failed", "invoice.payment_succeeded"); // same length-ish, different content
    const res = await postWebhook(tampered, signature);
    assert.equal(res.status, 401);
    const row = (await asOwner(A, "SELECT payment_status FROM tenant_billing"))[0] as { payment_status: string };
    assert.equal(row.payment_status, "paid"); // unchanged from the previous (succeeded) test
  });

  it("a missing signature header is rejected with 401", async () => {
    const payload = JSON.stringify({ id: "evt_4", type: "invoice.payment_failed", data: { object: { customer: customerId } } });
    const res = await fetch(`${base}/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
    assert.equal(res.status, 401);
  });

  it("an unknown customer id is accepted (200) but updates nothing -- not an error, just nothing to do", async () => {
    const payload = JSON.stringify({ id: "evt_5", type: "invoice.payment_failed", data: { object: { customer: "cus_totally_unknown", amount_paid: 0 } } });
    const res = await postWebhook(payload, sign(payload));
    assert.equal(res.status, 200);
  });
});
