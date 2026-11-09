-- Per-staff-member "have I looked at Leads since the last new one arrived" marker, for a persistent Leads sidebar
-- badge (same UX as Inbox/Unanswered, but those are absolute pending-work counts -- this one is genuinely
-- "unseen since I last opened the page", so it needs its own per-user timestamp rather than a tenant-wide query.
-- Defaults to now() so existing staff don't see every already-existing lead flagged unseen on first deploy.
ALTER TABLE tenant_users ADD COLUMN leads_last_seen_at timestamptz NOT NULL DEFAULT now();
