-- Runs once when the database is created (docker-entrypoint-initdb.d).
-- Roles (PRD Section 3, "RLS Implementation Rules"):
--   app_migrator : owns the tables, runs migrations. Also bound by FORCE RLS.
--   app_user     : what the running application connects as. Not an owner, no BYPASSRLS.
--   app_resolver : NOLOGIN, BYPASSRLS. Owns ONLY the narrow SECURITY DEFINER functions that must
--                  find a tenant before tenant context exists (widget key, phone_number_id, email).
-- Passwords here are local-development defaults only; real environments use secrets.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE ROLE app_migrator LOGIN PASSWORD 'migrator_dev' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_user     LOGIN PASSWORD 'app_dev'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_resolver NOLOGIN BYPASSRLS;

GRANT ALL ON SCHEMA public TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_user, app_resolver;
GRANT app_resolver TO app_migrator;   -- lets migrations assign function ownership
