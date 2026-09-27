-- Phase 7: "Event outbox backend support for n8n-style automations" (lead/handoff emails, unanswered-question
-- digests, limit warnings, daily usage reports). event_outbox already exists and already receives lead_created/
-- handoff_requested/unanswered_logged events (Phase 5/6); this adds the webhook-delivery side of it, plus the
-- two event types nothing emits yet.
--
-- Deliberately a SEPARATE claim path from claim_push_events (0009/0011), not a shared one: that function already
-- flips event_outbox.status to 'done' the moment push claims a lead/handoff event, and it only ever looks at
-- those two event types. A webhook consumer needs to see every event type (including ones push never touches,
-- like unanswered_logged/limit_warning/daily_usage_report) independently of whether push already "used up" the
-- row -- so this tracks its own delivery state in its own column instead of fighting over the same status flag.
ALTER TABLE event_outbox ADD COLUMN webhook_delivered_at timestamptz;

-- Per-tenant n8n/Zapier/webhook target: the PRD's "n8n-style automations" are configured by the tenant, not
-- built into this app -- this table is just where the student stores which URL to POST events to.
CREATE TABLE automation_settings (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_url text,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_settings
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON automation_settings TO app_user;

CREATE FUNCTION claim_automation_events(p_limit integer) RETURNS TABLE (
  out_event_id uuid, out_tenant_id uuid, out_event_type text, out_payload jsonb, out_created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE event_outbox e SET webhook_delivered_at = now()
  FROM (
    SELECT id FROM event_outbox
     WHERE webhook_delivered_at IS NULL
     ORDER BY created_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ) claimed
  WHERE e.id = claimed.id
  RETURNING e.id, e.tenant_id, e.event_type, e.payload, e.created_at;
END;
$$;
ALTER FUNCTION claim_automation_events(integer) OWNER TO app_resolver;
REVOKE ALL ON FUNCTION claim_automation_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_automation_events(integer) TO app_user;
