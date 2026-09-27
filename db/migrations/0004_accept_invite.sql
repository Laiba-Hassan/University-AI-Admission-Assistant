-- Phase 5: staff invite accept flow needs the same "resolve before tenant context exists" pattern already used
-- for widget keys, WhatsApp phone numbers and auth-user membership (0001_schema.sql) -- a brand-new staff member
-- accepting an invite has no tenant context yet, and app_user cannot bypass RLS to look one up by a bare token.
CREATE FUNCTION accept_staff_invite(p_token_hash text, p_auth_user_id uuid) RETURNS TABLE (tenant_id uuid, tenant_name text, role user_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite staff_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite FROM staff_invites i JOIN tenants t ON t.id = i.tenant_id
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
