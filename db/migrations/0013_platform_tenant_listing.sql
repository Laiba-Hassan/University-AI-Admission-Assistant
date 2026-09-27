-- Phase 7: the Super Admin "Tenants" page needs to see every tenant at once, which the ordinary
-- tenant_isolation policy on tenants/tenant_limits (USING (id/tenant_id = current_tenant_id())) never allows
-- for app_user -- there is deliberately no tenant context in a platform-admin request. Same SECURITY DEFINER
-- pattern as resolve_tenants_by_auth_user: a narrow, read-only function owned by the BYPASSRLS app_resolver
-- role. Creating a tenant itself needs no such function -- the platform route sets app.tenant_id to the new
-- tenant's own freshly generated id before inserting, exactly like seed.ts, which satisfies the existing
-- WITH CHECK (id = current_tenant_id()) policy without bypassing anything.
GRANT SELECT ON tenant_limits TO app_resolver;

CREATE FUNCTION platform_list_tenants() RETURNS TABLE (
  id uuid, name text, subdomain text, status tenant_status, plan_label text, created_at timestamptz,
  web_enabled boolean, whatsapp_enabled boolean, monthly_conversation_limit int, monthly_message_limit int,
  staff_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.name, t.subdomain, t.status, t.plan_label, t.created_at,
         l.web_enabled, l.whatsapp_enabled, l.monthly_conversation_limit, l.monthly_message_limit,
         (SELECT count(*) FROM tenant_users u WHERE u.tenant_id = t.id) AS staff_count
  FROM tenants t JOIN tenant_limits l ON l.tenant_id = t.id
  ORDER BY t.created_at DESC
$$;
ALTER FUNCTION platform_list_tenants() OWNER TO app_resolver;
REVOKE ALL ON FUNCTION platform_list_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_list_tenants() TO app_user;

-- Suspending/reactivating a tenant is also a cross-tenant write a platform admin makes without ever holding
-- that tenant's own context -- same reasoning as the listing function above.
CREATE FUNCTION platform_set_tenant_status(p_id uuid, p_status tenant_status) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE tenants SET status = p_status WHERE id = p_id
$$;
ALTER FUNCTION platform_set_tenant_status(uuid, tenant_status) OWNER TO app_resolver;
REVOKE ALL ON FUNCTION platform_set_tenant_status(uuid, tenant_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_set_tenant_status(uuid, tenant_status) TO app_user;
GRANT UPDATE ON tenants TO app_resolver;
