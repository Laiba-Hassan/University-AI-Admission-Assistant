-- Phase 7: platform-owner approval of access_requests, and the Super Admin dashboard generally, need an
-- identity distinct from tenant_users (which is always scoped to one tenant under RLS). A platform admin signs
-- in through the same Supabase Auth used for staff, but this table is deliberately NOT tenant-scoped -- no RLS,
-- same as access_requests itself, since "is this person a platform admin at all" has to be answerable before any
-- tenant context exists.
CREATE TABLE platform_admins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  email        text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON platform_admins TO app_user;
GRANT SELECT ON platform_admins TO app_resolver;

-- Resolving "is this auth_user_id a platform admin" needs to run before any tenant context exists, same
-- SECURITY DEFINER pattern as resolve_tenant_by_widget_key/resolve_tenant_by_phone_number_id.
CREATE FUNCTION is_platform_admin(p_auth_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE auth_user_id = p_auth_user_id)
$$;
ALTER FUNCTION is_platform_admin(uuid) OWNER TO app_resolver;
REVOKE ALL ON FUNCTION is_platform_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_platform_admin(uuid) TO app_user;
