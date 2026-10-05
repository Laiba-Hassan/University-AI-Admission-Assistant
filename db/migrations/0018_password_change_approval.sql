-- Non-admin staff (editor/viewer) can no longer change their own password unencumbered -- they request it, an
-- admin approves, and the approval is consumed (cleared) the moment they actually change it, so each approval is
-- single-use rather than a standing bypass. Admins are unaffected: no request/approval needed for their own account.
ALTER TABLE tenant_users ADD COLUMN password_change_requested_at timestamptz;
ALTER TABLE tenant_users ADD COLUMN password_change_approved_at timestamptz;
