-- 0004's accept_staff_invite() named its RETURNS TABLE output columns tenant_id/role -- the exact same names as
-- real columns on staff_invites/tenant_users. PL/pgSQL turns each OUT column into an in-scope variable for the
-- whole function body, so every embedded query touching those columns (even fully-qualified ones, per Postgres's
-- documented gotcha for this pattern) raised "column reference is ambiguous". Renaming the OUT parameters is the
-- documented fix; CREATE OR REPLACE with the same argument list keeps the existing owner and EXECUTE grant.
-- CREATE OR REPLACE cannot rename a RETURNS TABLE function's output columns (that counts as a return-type
-- change), so the broken version has to be dropped first.
DROP FUNCTION accept_staff_invite(text, uuid);

CREATE FUNCTION accept_staff_invite(p_token_hash text, p_auth_user_id uuid)
RETURNS TABLE (out_tenant_id uuid, out_tenant_name text, out_role user_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite staff_invites%ROWTYPE;
BEGIN
  SELECT i.* INTO v_invite FROM staff_invites i JOIN tenants t ON t.id = i.tenant_id
    WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.expires_at > now() AND t.status = 'active'
    FOR UPDATE OF i;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO tenant_users (tenant_id, auth_user_id, email, role)
  VALUES (v_invite.tenant_id, p_auth_user_id, v_invite.email, v_invite.role)
  ON CONFLICT (tenant_id, email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, role = EXCLUDED.role;

  UPDATE staff_invites SET accepted_at = now() WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.tenant_id, t.name, v_invite.role FROM tenants t WHERE t.id = v_invite.tenant_id;
END;
$$;

ALTER FUNCTION accept_staff_invite(text, uuid) OWNER TO app_resolver;
REVOKE ALL ON FUNCTION accept_staff_invite(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_staff_invite(text, uuid) TO app_user;
