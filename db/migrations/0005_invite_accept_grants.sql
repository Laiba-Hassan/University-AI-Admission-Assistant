-- 0004 gave app_resolver ownership of accept_staff_invite() but never granted it the table access the function
-- body actually needs (only widget_keys/channel_connections/tenant_users[select]/tenants were granted in 0001,
-- and none of that covers staff_invites or writing to tenant_users) -- caught by a real test: every accept
-- attempt failed with "permission denied for table staff_invites".
GRANT SELECT, UPDATE ON staff_invites TO app_resolver;
GRANT INSERT, UPDATE ON tenant_users TO app_resolver;
