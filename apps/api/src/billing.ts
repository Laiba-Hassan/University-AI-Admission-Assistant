import Stripe from "stripe";
import { config } from "./config.js";
import { withoutTenant, withTenant, type Tx } from "./db.js";

// Self-service plan selection with real recurring billing. Stripe Elements on the dashboard side tokenizes the
// card in Stripe's own hosted iframe -- the raw card number and CVV never reach this server at all. All we ever
// receive back from Stripe's API is a PaymentMethod id and (once attached) the card's brand/last4/expiry, which
// is the only card data this app ever stores. The actual monthly charge is Stripe's own job (a Subscription),
// not something this app's code triggers on a timer -- Stripe charges the card every cycle on its own and tells
// us the outcome over the webhook below.

export const stripeConfigured = Boolean(config.STRIPE_SECRET_KEY);
const stripe = config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : null;

export type Plan = "starter" | "growth";
export const PLAN_WHATSAPP: Record<Plan, boolean> = { starter: false, growth: true };
export const PLAN_PRICE_CENTS: Record<Plan, number> = { starter: 4900, growth: 9900 };
export const PLAN_NAME: Record<Plan, string> = { starter: "Starter", growth: "Growth" };

// A real trial, not a sales gimmick -- a university that skips picking a plan during onboarding gets this long
// to actually try the assistant with real students before the widget stops answering (migration 0023).
export const DEMO_DAYS = 4;
// How long a failing card gets before the widget stops answering too (migration 0024's resolver functions use
// the same 5 literally -- keep both in sync if this ever changes).
export const GRACE_DAYS = 5;

export async function startDemo(tx: Tx) {
  await tx.query(
    `UPDATE tenants SET plan_label = 'demo', demo_expires_at = now() + make_interval(days => $1) WHERE id = current_tenant_id()`,
    [DEMO_DAYS]);
  await tx.query(`UPDATE tenant_limits SET whatsapp_enabled = false`);
}

export async function getBillingStatus(tx: Tx) {
  const tenant = (await tx.query(`SELECT plan_label, demo_expires_at FROM tenants`)).rows[0] as
    { plan_label: string; demo_expires_at: string | null };
  const billing = (await tx.query(
    `SELECT card_brand, card_last4, card_exp_month, card_exp_year, payment_status, payment_failed_at, stripe_subscription_id
       FROM tenant_billing`)).rows[0] as
    { card_brand: string | null; card_last4: string | null; card_exp_month: number | null; card_exp_year: number | null;
      payment_status: string; payment_failed_at: string | null; stripe_subscription_id: string | null } | undefined;
  return {
    plan_label: tenant.plan_label, demo_expires_at: tenant.demo_expires_at,
    payment_status: billing?.payment_status ?? null, payment_failed_at: billing?.payment_failed_at ?? null,
    subscribed: Boolean(billing?.stripe_subscription_id),
    card: billing?.card_last4 ? { brand: billing.card_brand, last4: billing.card_last4, exp_month: billing.card_exp_month, exp_year: billing.card_exp_year } : null,
  };
}

/** One Stripe Price per plan, created once and found by lookup_key on every later call -- no extra table of
 * price ids to keep in sync, Stripe itself is the source of truth. A fresh test-mode Stripe account has none of
 * these yet; the first real checkout after keys are added creates them. */
const priceCache = new Map<Plan, string>();
async function ensurePriceId(plan: Plan): Promise<string> {
  if (priceCache.has(plan)) return priceCache.get(plan)!;
  const lookupKey = `${plan}_monthly`;
  const existing = await stripe!.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data[0]) { priceCache.set(plan, existing.data[0].id); return existing.data[0].id; }
  const product = await stripe!.products.create({ name: `${PLAN_NAME[plan]} plan` });
  const price = await stripe!.prices.create({
    product: product.id, unit_amount: PLAN_PRICE_CENTS[plan], currency: "usd",
    recurring: { interval: "month" }, lookup_key: lookupKey,
  });
  priceCache.set(plan, price.id);
  return price.id;
}

/** Step 1 of choosing a plan: mint (or reuse) a Stripe Customer for this tenant and a SetupIntent for it. The
 * dashboard confirms this client-side with Stripe.js against the card the admin types into Stripe's own Element
 * -- this server never sees the card itself, only the client_secret needed to drive that confirmation. */
export async function createSetupIntent(tx: Tx, tenantName: string, adminEmail: string) {
  if (!stripe) return null;
  const existing = (await tx.query(`SELECT stripe_customer_id FROM tenant_billing`)).rows[0]?.stripe_customer_id as string | null | undefined;
  let customerId = existing ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({ name: tenantName, email: adminEmail });
    customerId = customer.id;
    await tx.query(
      `INSERT INTO tenant_billing (tenant_id, stripe_customer_id) VALUES (current_tenant_id(), $1)
       ON CONFLICT (tenant_id) DO UPDATE SET stripe_customer_id = $1`, [customerId]);
  }
  const intent = await stripe.setupIntents.create({ customer: customerId, usage: "off_session" });
  return { client_secret: intent.client_secret, publishable_key: config.STRIPE_PUBLISHABLE_KEY };
}

export type ChoosePlanResult = { ok: true } | { ok: false; error: "stripe_not_configured" | "no_setup_intent" | "payment_method_mismatch" };

/** Step 2: the admin has confirmed the SetupIntent client-side and we have a real, tokenized PaymentMethod id
 * back. Attaches it as the customer's default, then either creates a brand-new monthly Subscription or -- if
 * this tenant already has one (switching plans, or just fixing a failed card) -- updates the existing
 * subscription's price and payment method in place instead of creating a second one. Stripe then charges this
 * card automatically every cycle on its own; nothing in this app's own code ever triggers a recurring charge. */
export async function choosePlan(tx: Tx, plan: Plan, paymentMethodId: string): Promise<ChoosePlanResult> {
  if (!stripe) return { ok: false, error: "stripe_not_configured" };
  const billing = (await tx.query(`SELECT stripe_customer_id, stripe_subscription_id FROM tenant_billing`)).rows[0] as
    { stripe_customer_id: string | null; stripe_subscription_id: string | null } | undefined;
  if (!billing?.stripe_customer_id) return { ok: false, error: "no_setup_intent" };

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (pm.customer !== billing.stripe_customer_id) return { ok: false, error: "payment_method_mismatch" };
  await stripe.customers.update(billing.stripe_customer_id, { invoice_settings: { default_payment_method: paymentMethodId } });

  const priceId = await ensurePriceId(plan);
  let subscriptionId = billing.stripe_subscription_id;
  if (subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: sub.items.data[0]!.id, price: priceId }],
      default_payment_method: paymentMethodId, proration_behavior: "create_prorations",
    });
    // A fresh card on an already-failing subscription: give it a real chance immediately rather than waiting
    // for Stripe's own retry schedule, which can be days away.
    const latestInvoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
    if (latestInvoiceId) {
      const invoice = await stripe.invoices.retrieve(latestInvoiceId);
      if (invoice.status === "open") await stripe.invoices.pay(latestInvoiceId).catch(() => {}); // best-effort; the webhook is the real source of truth either way
    }
  } else {
    const sub = await stripe.subscriptions.create({
      customer: billing.stripe_customer_id, items: [{ price: priceId }], default_payment_method: paymentMethodId,
    });
    subscriptionId = sub.id;
  }

  const card = pm.card;
  await tx.query(
    `UPDATE tenant_billing SET card_brand = $1, card_last4 = $2, card_exp_month = $3, card_exp_year = $4,
       stripe_subscription_id = $5, stripe_price_id = $6, payment_status = 'paid', payment_failed_at = NULL, updated_at = now()
     WHERE tenant_id = current_tenant_id()`,
    [card?.brand ?? null, card?.last4 ?? null, card?.exp_month ?? null, card?.exp_year ?? null, subscriptionId, priceId]);
  await tx.query(`UPDATE tenants SET plan_label = $1, demo_expires_at = NULL WHERE id = current_tenant_id()`, [plan]);
  await tx.query(`UPDATE tenant_limits SET whatsapp_enabled = $1`, [PLAN_WHATSAPP[plan]]);
  return { ok: true };
}

// ---------------------------------------------------------------- the webhook (async, no tenant context yet)

export const resolveTenantByStripeCustomer = (customerId: string) =>
  withoutTenant(async (tx) => (await tx.query("SELECT resolve_tenant_by_stripe_customer($1) AS id", [customerId])).rows[0]?.id as string | null);

/** Verifies the signature (fails closed with no STRIPE_WEBHOOK_SECRET configured, same posture as the WhatsApp
 * webhook's own signature check) and returns the parsed event, or null if it couldn't be verified. */
export function verifyWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event | null {
  if (!stripe || !config.STRIPE_WEBHOOK_SECRET || !signature) return null;
  try { return stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET); } catch { return null; }
}

/** A renewal (or the very first charge right after choosing a plan) went through. Clears any grace-period
 * clock immediately -- a tenant that was mid-grace-period and then paid must regain access right away, not
 * linger blocked until some other event clears it. */
async function onInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const tenantId = customerId && await resolveTenantByStripeCustomer(customerId);
  if (!tenantId) return; // unknown customer: nothing in this app to update
  await withTenant(tenantId, (tx) =>
    tx.query(
      `UPDATE tenant_billing SET payment_status = 'paid', payment_failed_at = NULL,
         lifetime_revenue_cents = lifetime_revenue_cents + $1, updated_at = now() WHERE tenant_id = current_tenant_id()`,
      [invoice.amount_paid]));
}

/** The first failure in a billing cycle starts the grace-period clock (COALESCE -- a second, third... retry
 * failing again must NOT push the clock forward, or a card that's been failing for weeks could look like it
 * just started failing today). Clearing it only happens on an actual success, above. */
async function onInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const tenantId = customerId && await resolveTenantByStripeCustomer(customerId);
  if (!tenantId) return;
  await withTenant(tenantId, (tx) =>
    tx.query(`UPDATE tenant_billing SET payment_status = 'failed', payment_failed_at = COALESCE(payment_failed_at, now()), updated_at = now() WHERE tenant_id = current_tenant_id()`));
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "invoice.payment_succeeded") await onInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
  else if (event.type === "invoice.payment_failed") await onInvoicePaymentFailed(event.data.object as Stripe.Invoice);
  // Other event types (subscription.deleted, etc.) are deliberately not handled yet -- out of the scope asked
  // for (automatic monthly charging + a blocked widget on failure), not silently mis-handled.
}
