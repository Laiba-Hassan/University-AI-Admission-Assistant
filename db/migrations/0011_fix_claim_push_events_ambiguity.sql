-- Same PL/pgSQL gotcha as accept_staff_invite (migration 0006): an OUT parameter named the same as a real
-- column (here, event_type) shadows it inside the function body, making "e.event_type" ambiguous even though
-- it looks qualified. Renaming the OUT parameters, not the query.
DROP FUNCTION claim_push_events(integer);
CREATE FUNCTION claim_push_events(p_limit integer) RETURNS TABLE (out_event_id uuid, out_tenant_id uuid, out_event_type text, out_payload jsonb)
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

ALTER FUNCTION claim_push_events(integer) OWNER TO app_resolver;
REVOKE ALL ON FUNCTION claim_push_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_push_events(integer) TO app_user;
