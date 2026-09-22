-- Phase 4: fixed-window rate limiting for the public widget endpoints (PRD Section 11, "per-IP / per-session /
-- per-tenant rate limits"). Not tenant-owned data (an IP or session bucket must be checkable before/across tenant
-- context, same reasoning as access_requests), so it is not RLS-scoped; app_user gets only INSERT/UPDATE, never a
-- broad SELECT of other buckets. Old buckets are cheap to prune (see comment on cleanup below).
CREATE TABLE rate_limit_buckets (
  bucket_key   text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
-- Old windows are never read again; prune them opportunistically rather than running a scheduled job for V1.3.
CREATE INDEX rate_limit_buckets_window_idx ON rate_limit_buckets (window_start);

GRANT SELECT, INSERT, UPDATE ON rate_limit_buckets TO app_user;
GRANT SELECT, DELETE ON rate_limit_buckets TO app_user;
