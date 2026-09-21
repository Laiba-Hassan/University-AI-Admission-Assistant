-- One-time role setup for a hosted Supabase project (staging). Paste into Supabase Dashboard -> SQL Editor and run
-- once. This is the hosted equivalent of infra/init-roles.sql, which only runs automatically under Docker.
--
-- BEFORE RUNNING: replace the three CHANGE_ME_* passwords with long random values (e.g. `openssl rand -base64 32`,
-- avoid @ : / ? # in them so they stay URL-safe). Keep them in your secret store, never in git. They go into
-- DATABASE_URL (app_user), DATABASE_URL_MIGRATOR (app_migrator) and DATABASE_URL_QUEUE (app_queue).
-- Supabase's database is named "postgres" (not "admission").

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE ROLE app_migrator LOGIN PASSWORD 'CHANGE_ME_MIGRATOR' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_user     LOGIN PASSWORD 'CHANGE_ME_APP'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_queue    LOGIN PASSWORD 'CHANGE_ME_QUEUE'    NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_resolver NOLOGIN BYPASSRLS;
GRANT CREATE ON DATABASE postgres TO app_queue;   -- pg-boss installs its own "pgboss" schema

GRANT ALL ON SCHEMA public TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_user, app_resolver;
GRANT app_resolver TO app_migrator;               -- lets migrations assign function ownership
