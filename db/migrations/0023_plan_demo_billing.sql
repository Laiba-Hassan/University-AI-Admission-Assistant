-- Self-service plan selection: an admin can now finish onboarding by either picking a real plan (card captured
-- via Stripe Elements -- the raw card number never reaches this server, only a token; see apps/api/src/billing.ts)
-- or skipping straight to a time-limited demo. tenants.plan_label already existed (free text); this is what
-- actually gives it a real, enforced meaning: 'demo' | 'starter' | 'growth'.

ALTER TABLE tenants ADD COLUMN demo_expires_at timestamptz;

-- Card details: ONLY what Stripe's own API hands back after tokenizing the card on its own hosted field --
-- never the full PAN or CVV, which never transit this server at all. stripe_customer_id is what lets a tenant's
-- SetupIntent be re-created idempotently instead of minting a new Stripe customer on every attempt.
ALTER TABLE tenant_billing ADD COLUMN stripe_customer_id text;
ALTER TABLE tenant_billing ADD COLUMN card_brand text;
ALTER TABLE tenant_billing ADD COLUMN card_last4 text;
ALTER TABLE tenant_billing ADD COLUMN card_exp_month smallint;
ALTER TABLE tenant_billing ADD COLUMN card_exp_year smallint;

-- The actual enforcement: a demo tenant whose time is up can no longer be resolved at all, on either public
-- channel -- this is what "the widget stops working" means in practice, with no cron job needed (checked live,
-- at request time, the same way an inactive tenant already fails to resolve here). Staff dashboard access is
-- deliberately NOT gated by this (resolve_tenants_by_auth_user is untouched) -- an admin whose demo expired must
-- still be able to log in and pick a real plan.
CREATE OR REPLACE FUNCTION resolve_tenant_by_widget_key(p_key text, p_origin text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.tenant_id FROM widget_keys w JOIN tenants t ON t.id = w.tenant_id
  WHERE w.public_key = p_key AND w.status = 'active' AND t.status = 'active'
    AND p_origin = ANY (w.allowed_origins)
    AND (t.demo_expires_at IS NULL OR t.demo_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION resolve_tenant_by_phone_number_id(p_phone_number_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.tenant_id FROM channel_connections c JOIN tenants t ON t.id = c.tenant_id
  WHERE c.phone_number_id = p_phone_number_id AND c.channel = 'whatsapp' AND t.status = 'active'
    AND (t.demo_expires_at IS NULL OR t.demo_expires_at > now())
$$;
