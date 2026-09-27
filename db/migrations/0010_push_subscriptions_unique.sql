-- A browser's push endpoint should be unique per tenant (re-subscribing the same device/browser updates its
-- keys in place rather than accumulating duplicate rows); push.ts's savePushSubscription() upserts on it.
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_tenant_endpoint_key UNIQUE (tenant_id, endpoint);
