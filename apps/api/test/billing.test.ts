// Self-service plan selection (billing.ts): the demo lifecycle and the config-aware fallbacks are fully testable
// without a real Stripe account. The actual card-tokenization round trip through Stripe's live API is NOT
// exercised here -- no test Stripe key is configured in this environment, and choosePlan() only ever receives a
// PaymentMethod id that a real confirmed SetupIntent produces, which can't be faked without hitting Stripe for
// real. What IS fully covered: the demo starts/expires correctly, GET /me reflects it, and every billing route
// degrades honestly (503 stripe_not_configured) rather than pretending to work with no key set.
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
const post = async (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { ...(await auth()), "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  db = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  A = await withOwner((c) => createTenant(c, "Billing", 100_000));
  server = createApp(async () => null).listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
});
after(async () => { server.close(); await deleteTenants([A.id]); await db.pool.end(); });

describe("POST /api/v1/onboarding/start-demo", () => {
  it("sets plan_label='demo', a 4-day expiry, turns WhatsApp off, and leaves onboarding unmarked so 'Finish tenant setup' keeps showing", async () => {
    const res = await post("/api/v1/onboarding/start-demo", {});
    assert.equal(res.status, 204);
    const row = (await asOwner(A, "SELECT plan_label, demo_expires_at, onboarding_completed_at FROM tenants"))[0] as
      { plan_label: string; demo_expires_at: Date; onboarding_completed_at: Date | null };
    assert.equal(row.plan_label, "demo");
    assert.equal(row.onboarding_completed_at, null);
    const daysOut = (row.demo_expires_at.getTime() - Date.now()) / 86_400_000;
    assert.ok(daysOut > 3.9 && daysOut < 4.1, `expected ~4 days out, got ${daysOut}`);
    const limits = (await asOwner(A, "SELECT whatsapp_enabled FROM tenant_limits"))[0] as { whatsapp_enabled: boolean };
    assert.equal(limits.whatsapp_enabled, false);
  });

  it("only an admin can start the demo", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'viewer' WHERE tenant_id = current_tenant_id()");
    assert.equal((await post("/api/v1/onboarding/start-demo", {})).status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
  });
});

describe("GET /api/v1/me reflects the plan", () => {
  it("returns planLabel and demoExpiresAt matching what start-demo just set", async () => {
    const me = (await (await get("/api/v1/me")).json()) as { planLabel: string; demoExpiresAt: string | null };
    assert.equal(me.planLabel, "demo");
    assert.ok(me.demoExpiresAt);
  });
});

describe("GET /api/v1/billing/status", () => {
  it("reports the demo plan and no card on file yet", async () => {
    const body = (await (await get("/api/v1/billing/status")).json()) as { plan_label: string; card: unknown };
    assert.equal(body.plan_label, "demo");
    assert.equal(body.card, null);
  });
});

// This dev/test environment has no STRIPE_SECRET_KEY configured -- both routes must degrade honestly rather
// than 500 or silently pretend to succeed.
describe("billing routes without Stripe configured", () => {
  it("POST /billing/setup-intent returns 503 stripe_not_configured", async () => {
    const res = await post("/api/v1/billing/setup-intent", {});
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "stripe_not_configured" });
  });

  it("POST /billing/choose-plan returns 503 stripe_not_configured instead of touching tenant_limits", async () => {
    const before = (await asOwner(A, "SELECT whatsapp_enabled FROM tenant_limits"))[0] as { whatsapp_enabled: boolean };
    const res = await post("/api/v1/billing/choose-plan", { plan: "growth", payment_method_id: "pm_fake" });
    assert.equal(res.status, 503);
    const after = (await asOwner(A, "SELECT whatsapp_enabled FROM tenant_limits"))[0] as { whatsapp_enabled: boolean };
    assert.equal(after.whatsapp_enabled, before.whatsapp_enabled); // refused before ever touching the plan
  });

  it("rejects an invalid plan value before ever reaching Stripe", async () => {
    const res = await post("/api/v1/billing/choose-plan", { plan: "enterprise", payment_method_id: "pm_fake" });
    assert.equal(res.status, 400);
  });

  it("only an admin can call either billing route", async () => {
    await asOwner(A, "UPDATE tenant_users SET role = 'editor' WHERE tenant_id = current_tenant_id()");
    assert.equal((await post("/api/v1/billing/setup-intent", {})).status, 403);
    assert.equal((await post("/api/v1/billing/choose-plan", { plan: "starter", payment_method_id: "pm_fake" })).status, 403);
    await asOwner(A, "UPDATE tenant_users SET role = 'admin' WHERE tenant_id = current_tenant_id()");
  });
});

// The webhook's own invoice handlers (billing.ts's onInvoicePaymentSucceeded/Failed) never call out to Stripe's
// API at all -- they only resolve a customer id to a tenant (SQL) and write the result (SQL) -- so these are
// fully testable by calling handleStripeEvent directly with a hand-built event, no Stripe key needed. The HTTP
// layer's signature verification is covered separately in stripe-webhook.test.ts, which DOES set a (fake) key.
describe("webhook event handlers (billing.ts, called directly)", () => {
  const customerId = "cus_test_billing_file";
  const fakeInvoice = (overrides: Record<string, unknown> = {}) => ({ customer: customerId, amount_paid: 4900, ...overrides });

  before(async () => {
    // createTenant() never creates a tenant_billing row (only createSetupIntent does, on first real checkout) --
    // an UPDATE against a row that doesn't exist yet silently matches zero rows, so this must upsert.
    await asOwner(A, "INSERT INTO tenant_billing (tenant_id, stripe_customer_id) VALUES (current_tenant_id(), $1) ON CONFLICT (tenant_id) DO UPDATE SET stripe_customer_id = $1", [customerId]);
  });

  it("a failed invoice sets payment_status='failed' and stamps payment_failed_at", async () => {
    const { handleStripeEvent } = await import("../src/billing.js");
    await handleStripeEvent({ type: "invoice.payment_failed", data: { object: fakeInvoice() } } as never);
    const row = (await asOwner(A, "SELECT payment_status, payment_failed_at FROM tenant_billing"))[0] as { payment_status: string; payment_failed_at: Date | null };
    assert.equal(row.payment_status, "failed");
    assert.ok(row.payment_failed_at);
  });

  it("a SECOND failed invoice does NOT push payment_failed_at forward (COALESCE, not overwrite)", async () => {
    const { handleStripeEvent } = await import("../src/billing.js");
    const first = (await asOwner(A, "SELECT payment_failed_at FROM tenant_billing"))[0] as { payment_failed_at: Date };
    await new Promise((r) => setTimeout(r, 20));
    await handleStripeEvent({ type: "invoice.payment_failed", data: { object: fakeInvoice() } } as never);
    const second = (await asOwner(A, "SELECT payment_failed_at FROM tenant_billing"))[0] as { payment_failed_at: Date };
    assert.equal(first.payment_failed_at.getTime(), second.payment_failed_at.getTime());
  });

  it("a succeeded invoice clears payment_failed_at, sets payment_status='paid', and adds to lifetime revenue", async () => {
    const { handleStripeEvent } = await import("../src/billing.js");
    const before = (await asOwner(A, "SELECT lifetime_revenue_cents FROM tenant_billing"))[0] as { lifetime_revenue_cents: string };
    await handleStripeEvent({ type: "invoice.payment_succeeded", data: { object: fakeInvoice({ amount_paid: 4900 }) } } as never);
    const row = (await asOwner(A, "SELECT payment_status, payment_failed_at, lifetime_revenue_cents FROM tenant_billing"))[0] as
      { payment_status: string; payment_failed_at: Date | null; lifetime_revenue_cents: string };
    assert.equal(row.payment_status, "paid");
    assert.equal(row.payment_failed_at, null);
    assert.equal(Number(row.lifetime_revenue_cents), Number(before.lifetime_revenue_cents) + 4900);
  });

  it("an unknown Stripe customer id is a safe no-op, not an error", async () => {
    const { handleStripeEvent } = await import("../src/billing.js");
    await handleStripeEvent({ type: "invoice.payment_failed", data: { object: fakeInvoice({ customer: "cus_does_not_exist" }) } } as never); // must not throw
  });
});

describe("failed-payment grace period blocks the public widget (migration 0024)", () => {
  it("resolve_tenant_by_widget_key refuses once payment_failed_at is older than the grace period, and allows it back the moment payment succeeds", async () => {
    const widgetKey = (await asOwner(A, "SELECT public_key FROM widget_keys LIMIT 1"))[0] as { public_key: string } | undefined;
    if (!widgetKey) return; // fixture tenants always get one (createTenant), but guard defensively
    const resolve = () => asOwner(A, "SELECT resolve_tenant_by_widget_key($1, $2) AS id", [widgetKey.public_key, A.origin]);

    await asOwner(A, "INSERT INTO tenant_billing (tenant_id, payment_failed_at) VALUES (current_tenant_id(), now() - interval '1 day') ON CONFLICT (tenant_id) DO UPDATE SET payment_failed_at = EXCLUDED.payment_failed_at");
    assert.ok((await resolve())[0]!.id, "still within the 5-day grace period");

    await asOwner(A, "UPDATE tenant_billing SET payment_failed_at = now() - interval '6 days' WHERE tenant_id = current_tenant_id()");
    assert.equal((await resolve())[0]!.id, null, "grace period is up");

    await asOwner(A, "UPDATE tenant_billing SET payment_failed_at = NULL WHERE tenant_id = current_tenant_id()");
    assert.ok((await resolve())[0]!.id, "cleared -- resolves again");
  });
});
