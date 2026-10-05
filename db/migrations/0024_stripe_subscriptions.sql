-- Real recurring billing: Stripe Subscriptions, not just a card on file. A monthly invoice either succeeds or
-- fails entirely async (Stripe tells us over a webhook, there's no "check back later" polling) -- these two
-- columns are what that webhook actually writes.
ALTER TABLE tenant_billing ADD COLUMN stripe_subscription_id text;
ALTER TABLE tenant_billing ADD COLUMN stripe_price_id text;
-- Set the moment the FIRST failed invoice for the current billing cycle comes in (never overwritten by a repeat
-- failure -- see billing.ts's onInvoicePaymentFailed), so it's a stable countdown anchor, not a clock that keeps
-- resetting itself every time Stripe's automatic retry schedule tries again and fails again. Cleared back to
-- NULL the moment a payment actually succeeds.
ALTER TABLE tenant_billing ADD COLUMN payment_failed_at timestamptz;

-- The webhook receives a Stripe customer id and nothing else -- no tenant context exists yet, same situation a
-- widget key or WhatsApp phone_number_id is in. Same SECURITY DEFINER pattern as those two resolvers (0001): the
-- only thing this is allowed to do is map an opaque id to a tenant id.
CREATE FUNCTION resolve_tenant_by_stripe_customer(p_customer_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM tenant_billing WHERE stripe_customer_id = p_customer_id
$$;
GRANT SELECT ON tenant_billing TO app_resolver;
ALTER FUNCTION resolve_tenant_by_stripe_customer(text) OWNER TO app_resolver;
REVOKE ALL ON FUNCTION resolve_tenant_by_stripe_customer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_stripe_customer(text) TO app_user;

-- The actual enforcement, same mechanism as demo expiry: a tenant whose payment has been failing for longer than
-- the grace period can no longer be resolved on either public channel at all. GRACE_DAYS (billing.ts) = 5.
CREATE OR REPLACE FUNCTION resolve_tenant_by_widget_key(p_key text, p_origin text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.tenant_id FROM widget_keys w JOIN tenants t ON t.id = w.tenant_id LEFT JOIN tenant_billing b ON b.tenant_id = t.id
  WHERE w.public_key = p_key AND w.status = 'active' AND t.status = 'active'
    AND p_origin = ANY (w.allowed_origins)
    AND (t.demo_expires_at IS NULL OR t.demo_expires_at > now())
    AND (b.payment_failed_at IS NULL OR b.payment_failed_at > now() - interval '5 days')
$$;

CREATE OR REPLACE FUNCTION resolve_tenant_by_phone_number_id(p_phone_number_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.tenant_id FROM channel_connections c JOIN tenants t ON t.id = c.tenant_id LEFT JOIN tenant_billing b ON b.tenant_id = t.id
  WHERE c.phone_number_id = p_phone_number_id AND c.channel = 'whatsapp' AND t.status = 'active'
    AND (t.demo_expires_at IS NULL OR t.demo_expires_at > now())
    AND (b.payment_failed_at IS NULL OR b.payment_failed_at > now() - interval '5 days')
$$;
