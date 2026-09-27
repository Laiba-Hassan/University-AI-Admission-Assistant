-- Phase 6A: "a queue worker that sends a minimal alert ... on each new handoff and lead". event_outbox already
-- carries exactly those two event types (lead_created, handoff_requested) with a status/attempts column clearly
-- meant for a real outbox processor, but a worker that watches it needs to see PENDING rows across every
-- tenant at once -- something no ordinary app_user connection can do under FORCE RLS. Same SECURITY DEFINER
-- resolve-before-tenant-context pattern as resolve_tenant_by_widget_key/resolve_tenant_by_phone_number_id.
CREATE FUNCTION claim_push_events(p_limit integer) RETURNS TABLE (event_id uuid, out_tenant_id uuid, event_type text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE event_outbox e SET status = 'done', attempts = attempts + 1
  FROM (
    SELECT id FROM event_outbox
     WHERE status = 'pending' AND event_type IN ('lead_created', 'handoff_requested')
     ORDER BY created_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ) claimed
  WHERE e.id = claimed.id
  RETURNING e.id, e.tenant_id, e.event_type, e.payload;
END;
$$;

GRANT SELECT, UPDATE ON event_outbox TO app_resolver;
ALTER FUNCTION claim_push_events(integer) OWNER TO app_resolver;
REVOKE ALL ON FUNCTION claim_push_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_push_events(integer) TO app_user;
