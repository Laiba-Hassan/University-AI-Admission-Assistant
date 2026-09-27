-- Phase 7: the rest of the Super Admin surface (Enrollium_Super_Admin_Dashboard.pdf reference) -- editable usage
-- limits (already have the table; this adds the write path's audit trail), manual billing tracking ("Invoiced
-- outside platform" until real Stripe/gateway billing ships in a later release, per the reference deck's own
-- footnote), tenant support notes, sub-processors & DPA tracking, and the platform-admin audit log.

-- Manual billing tracking, not a payment gateway: a platform admin records what plan/price/cycle a tenant is on
-- and whether that month's invoice was paid, exactly the way the reference deck's own "Invoiced outside
-- platform" column describes it. No card is ever charged by this app.
CREATE TABLE tenant_billing (
  tenant_id                 uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_price_cents          integer NOT NULL DEFAULT 0,
  billing_cycle             text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
  payment_status            text NOT NULL DEFAULT 'trial' CHECK (payment_status IN ('trial', 'paid', 'failed', 'none')),
  invoiced_outside_platform boolean NOT NULL DEFAULT false,
  invoice_note              text,
  lifetime_revenue_cents    bigint NOT NULL DEFAULT 0,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_billing
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tenant_billing TO app_user;
GRANT SELECT ON tenant_billing TO app_resolver; -- read by platform_list_tenants() below

CREATE TABLE tenant_support_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  note        text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_by  text NOT NULL, -- the platform admin's email; platform_admins isn't tenant data, so no FK here
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE tenant_support_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_support_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_support_notes
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tenant_support_notes TO app_user;

-- Platform-level (not tenant data): the vendor list a real DPA/compliance review tracks. dpa_status defaults to
-- 'not_reviewed' rather than any vendor being pre-marked signed -- that status is only ever set here by a
-- platform admin who actually confirms it, never fabricated.
CREATE TABLE sub_processors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor        text NOT NULL,
  purpose       text NOT NULL,
  dpa_status    text NOT NULL DEFAULT 'not_reviewed' CHECK (dpa_status IN ('not_reviewed', 'signed', 'not_required')),
  last_reviewed date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON sub_processors TO app_user;

-- Single-row platform-wide defaults (data retention default, new-tenant plan caps).
CREATE TABLE platform_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_retention_days integer NOT NULL DEFAULT 90,
  default_plan_limits    jsonb NOT NULL DEFAULT '{"starter":{"conversations":1000,"messages":2000},"pro":{"conversations":5000,"messages":8000},"growth":{"conversations":6000,"messages":10000}}'
);
INSERT INTO platform_settings (id) VALUES (true);
GRANT SELECT, UPDATE ON platform_settings TO app_user;

-- Every platform-admin action, per the reference deck's Audit Log page -- not tenant data, retained indefinitely,
-- never editable by the app (no UPDATE/DELETE grant).
CREATE TABLE platform_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_email text NOT NULL,
  action      text NOT NULL,
  target      text,
  details     text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON platform_audit_log TO app_user;

-- Replaces 0013's version: adds billing columns so the Tenants and Billing pages can both list from one
-- function, same reasoning as before (app_user's own RLS can never see more than one tenant's row at a time).
DROP FUNCTION platform_list_tenants();
CREATE FUNCTION platform_list_tenants() RETURNS TABLE (
  id uuid, name text, subdomain text, status tenant_status, plan_label text, created_at timestamptz,
  web_enabled boolean, whatsapp_enabled boolean, monthly_conversation_limit int, monthly_message_limit int,
  staff_count bigint, plan_price_cents int, billing_cycle text, payment_status text,
  invoiced_outside_platform boolean, lifetime_revenue_cents bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.name, t.subdomain, t.status, t.plan_label, t.created_at,
         l.web_enabled, l.whatsapp_enabled, l.monthly_conversation_limit, l.monthly_message_limit,
         (SELECT count(*) FROM tenant_users u WHERE u.tenant_id = t.id) AS staff_count,
         COALESCE(b.plan_price_cents, 0), COALESCE(b.billing_cycle, 'monthly'), COALESCE(b.payment_status, 'trial'),
         COALESCE(b.invoiced_outside_platform, false), COALESCE(b.lifetime_revenue_cents, 0)
  FROM tenants t JOIN tenant_limits l ON l.tenant_id = t.id LEFT JOIN tenant_billing b ON b.tenant_id = t.id
  ORDER BY t.created_at DESC
$$;
ALTER FUNCTION platform_list_tenants() OWNER TO app_resolver;
REVOKE ALL ON FUNCTION platform_list_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_list_tenants() TO app_user;
