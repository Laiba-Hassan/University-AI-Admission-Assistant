-- 0001_schema.sql  —  full V1.3 schema (PRD Section 4).
-- Run as app_migrator. Every tenant-owned table carries tenant_id from the first migration.
-- Provisional choice: embeddings are vector(768); confirm/adjust after the Phase 1 embedding bake-off
-- (safe to change before any data exists).

-- ---------------------------------------------------------------- tenant context helper
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------- enums
CREATE TYPE row_status        AS ENUM ('draft', 'approved');
CREATE TYPE reply_script      AS ENUM ('urdu', 'roman_urdu', 'english');
CREATE TYPE tenant_status     AS ENUM ('active', 'suspended');
CREATE TYPE user_role         AS ENUM ('admin', 'editor', 'viewer');
CREATE TYPE request_status    AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE channel_type      AS ENUM ('web', 'whatsapp');
CREATE TYPE degree_level      AS ENUM ('diploma', 'bachelor', 'master', 'doctorate');
CREATE TYPE student_type      AS ENUM ('local', 'international');
CREATE TYPE fee_item_type     AS ENUM ('tuition', 'admission', 'hostel', 'other');
CREATE TYPE fee_per           AS ENUM ('semester', 'year', 'one-time', 'credit_hour');
CREATE TYPE import_source     AS ENUM ('csv', 'json', 'url', 'pdf');
CREATE TYPE import_status     AS ENUM ('staged', 'reviewed', 'committed', 'discarded');
CREATE TYPE draft_review      AS ENUM ('pending', 'accepted', 'edited', 'rejected');
CREATE TYPE conversation_status AS ENUM ('open', 'needs_human', 'human', 'closed');
CREATE TYPE message_role      AS ENUM ('user', 'assistant', 'staff');
CREATE TYPE content_type      AS ENUM ('text', 'voice');
CREATE TYPE unanswered_status AS ENUM ('open', 'answered', 'ignored');
CREATE TYPE lead_status       AS ENUM ('new', 'contacted', 'enrolled');
CREATE TYPE outbox_status     AS ENUM ('pending', 'processing', 'done', 'failed');
CREATE TYPE data_request_type AS ENUM ('export', 'delete');
CREATE TYPE simple_status     AS ENUM ('pending', 'in_progress', 'done', 'failed');

-- ---------------------------------------------------------------- platform-level (not tenant-owned)
CREATE TABLE access_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_name text NOT NULL,
  contact_name    text NOT NULL,
  email           text NOT NULL,
  phone           text,
  status          request_status NOT NULL DEFAULT 'pending',
  reviewed_by     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz
);

-- ---------------------------------------------------------------- tenants
CREATE TABLE tenants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  subdomain            text NOT NULL UNIQUE,
  status               tenant_status NOT NULL DEFAULT 'active',
  plan_label           text NOT NULL DEFAULT 'trial',
  branding             jsonb NOT NULL DEFAULT '{}',
  welcome_message      text,
  working_hours        jsonb NOT NULL DEFAULT '{}',
  default_reply_script reply_script NOT NULL DEFAULT 'english',
  retention_days       integer NOT NULL DEFAULT 180 CHECK (retention_days > 0),
  fee_stale_after_days integer NOT NULL DEFAULT 90 CHECK (fee_stale_after_days > 0),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_limits (
  tenant_id                  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_conversation_limit integer NOT NULL DEFAULT 500,
  monthly_message_limit      integer NOT NULL DEFAULT 5000,
  web_enabled                boolean NOT NULL DEFAULT true,
  whatsapp_enabled           boolean NOT NULL DEFAULT false
);

CREATE TABLE tenant_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_user_id    uuid,                          -- Supabase Auth user id
  email           text NOT NULL,
  role            user_role NOT NULL DEFAULT 'viewer',
  notify_leads    boolean NOT NULL DEFAULT true,
  notify_handoffs boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, email)
);

CREATE TABLE staff_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        user_role NOT NULL DEFAULT 'viewer',
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  invited_by  uuid REFERENCES tenant_users(id)
);

CREATE TABLE localized_messages (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       text NOT NULL CHECK (key IN ('welcome', 'fallback', 'handoff', 'after_hours')),
  language  reply_script NOT NULL,
  text      text NOT NULL,
  PRIMARY KEY (tenant_id, key, language)
);

CREATE TABLE widget_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  public_key      text NOT NULL UNIQUE,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'))
);

CREATE TABLE channel_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel          channel_type NOT NULL,
  phone_number_id  text UNIQUE,                  -- a Meta phone number belongs to exactly one tenant
  waba_id          text,
  display_number   text,
  token_secret_ref text,                         -- reference to encrypted secret, never the token itself
  template_status  text,
  status           text NOT NULL DEFAULT 'pending',
  connected_at     timestamptz
);

-- ---------------------------------------------------------------- structured university data
CREATE TABLE faculties (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      text NOT NULL,
  status    row_status NOT NULL DEFAULT 'draft',
  UNIQUE (tenant_id, id)
);

CREATE TABLE campuses (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      text NOT NULL,
  city      text,
  status    row_status NOT NULL DEFAULT 'draft',
  UNIQUE (tenant_id, id)
);

CREATE TABLE programs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  faculty_id         uuid,
  name               text NOT NULL,
  code               text,
  degree_level       degree_level NOT NULL,
  total_credit_hours integer CHECK (total_credit_hours > 0),
  status             row_status NOT NULL DEFAULT 'draft',
  UNIQUE (tenant_id, id),
  -- composite FK: a program can only reference a faculty of the SAME tenant
  FOREIGN KEY (tenant_id, faculty_id) REFERENCES faculties (tenant_id, id)
);

-- Which campuses offer a program (the PRD's "ask which campus first" rule depends on this).
CREATE TABLE program_campuses (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL,
  campus_id  uuid NOT NULL,
  PRIMARY KEY (program_id, campus_id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, campus_id)  REFERENCES campuses (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE fee_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id       uuid,                          -- NULL = applies to all programs (e.g. hostel)
  campus_id        uuid,                          -- NULL = applies to all campuses
  academic_year    text NOT NULL,
  student_type     student_type NOT NULL,
  item_type        fee_item_type NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency         char(3) NOT NULL,
  per              fee_per NOT NULL,
  effective_from   date,
  last_verified_at date,
  status           row_status NOT NULL DEFAULT 'draft',
  note             text,
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, campus_id)  REFERENCES campuses (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE intakes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id           uuid,                      -- NULL = all programs
  intake_name          text NOT NULL,
  applications_open    date,
  application_deadline date,
  test_date            date,
  classes_start        date,
  last_verified_at     date,
  status               row_status NOT NULL DEFAULT 'draft',
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE requirements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id         uuid NOT NULL,
  eligibility        text,
  required_documents text,
  status             row_status NOT NULL DEFAULT 'draft',
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE scholarships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  criteria   text,
  coverage   text,
  conditions text,
  deadline   date,
  status     row_status NOT NULL DEFAULT 'draft'
);

-- ---------------------------------------------------------------- knowledge (RAG)
CREATE TABLE faqs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question  text NOT NULL,
  answer    text NOT NULL,
  approved  boolean NOT NULL DEFAULT false
);

CREATE TABLE knowledge_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  source_type text NOT NULL,
  approved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE knowledge_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  content     text NOT NULL,
  embedding   vector(768),
  metadata    jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (tenant_id, document_id) REFERENCES knowledge_documents (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX knowledge_chunks_tenant_idx    ON knowledge_chunks (tenant_id);

-- ---------------------------------------------------------------- import pipeline
CREATE TABLE import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type import_source NOT NULL,
  status      import_status NOT NULL DEFAULT 'staged',
  created_by  uuid REFERENCES tenant_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE import_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id      uuid NOT NULL,
  target_table  text NOT NULL,
  payload       jsonb NOT NULL,
  review_status draft_review NOT NULL DEFAULT 'pending',
  reviewed_by   uuid REFERENCES tenant_users(id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batches (tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- conversations
CREATE TABLE contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel     channel_type NOT NULL,
  external_id text NOT NULL,                      -- web session id or WhatsApp wa_id
  consent_at  timestamptz,
  opted_out   boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, channel, external_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL,
  channel         channel_type NOT NULL,
  status          conversation_status NOT NULL DEFAULT 'open',
  assigned_to     uuid REFERENCES tenant_users(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id)
);
CREATE INDEX conversations_tenant_recent_idx ON conversations (tenant_id, last_message_at DESC);

CREATE TABLE messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id    uuid NOT NULL,
  role               message_role NOT NULL,
  content_type       content_type NOT NULL DEFAULT 'text',
  content            text NOT NULL,               -- text or transcript, PII-masked before storage
  detected_language  text,
  audio_seconds      numeric(8,2),
  channel_message_id text,                        -- WhatsApp message id; replay protection
  delivery_status    text,
  "timestamp"        timestamptz NOT NULL DEFAULT now(),
  metadata           jsonb NOT NULL DEFAULT '{}', -- tool calls, verifier outcome, model, token counts
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, channel_message_id),         -- a replayed webhook cannot insert twice
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX messages_conversation_idx ON messages (tenant_id, conversation_id, "timestamp");

CREATE TABLE message_feedback (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  rating     smallint NOT NULL CHECK (rating IN (-1, 1)),
  PRIMARY KEY (message_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messages (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id       uuid,
  name             text,
  contact          text,
  program_interest text,
  source           channel_type,
  status           lead_status NOT NULL DEFAULT 'new',
  consent          boolean NOT NULL DEFAULT false,
  notes            text,
  assigned_to      uuid REFERENCES tenant_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id)
);

CREATE TABLE unanswered_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  embedding     vector(768),
  cluster_id    uuid,
  count         integer NOT NULL DEFAULT 1,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  status        unanswered_status NOT NULL DEFAULT 'open',
  linked_faq_id uuid REFERENCES faqs(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------- platform plumbing
CREATE TABLE usage_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel    channel_type,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  metadata   jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX usage_events_tenant_time_idx ON usage_events (tenant_id, "timestamp");

CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid,
  action     text NOT NULL,
  resource   text,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  metadata   jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE event_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',     -- never contains student name or phone number
  status     outbox_status NOT NULL DEFAULT 'pending',
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         data_request_type NOT NULL,
  requested_by uuid REFERENCES tenant_users(id),
  status       simple_status NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL,
  keys         text NOT NULL,                 -- encrypted at the application layer
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- ---------------------------------------------------------------- ownership + Row-Level Security
-- Every tenant-owned table: RLS enabled AND forced (owner is bound too), one policy keyed on
-- app.tenant_id, which the app sets per transaction with SET LOCAL.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_limits','tenant_users','staff_invites','localized_messages','widget_keys','channel_connections',
    'faculties','campuses','programs','program_campuses','fee_items','intakes','requirements','scholarships',
    'faqs','knowledge_documents','knowledge_chunks','import_batches','import_drafts','contacts','conversations',
    'messages','message_feedback','leads','unanswered_questions','usage_events','audit_logs','event_outbox',
    'data_requests','push_subscriptions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                      USING (tenant_id = current_tenant_id())
                      WITH CHECK (tenant_id = current_tenant_id())$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;

-- tenants: keyed on id rather than tenant_id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tenants TO app_user;   -- no DELETE: tenant removal is a platform operation

-- access_requests: platform-level sign-up queue, deliberately not tenant-scoped (no tenant exists yet).
-- Reviewed only by platform-owner routes; it holds no tenant data.
GRANT SELECT, INSERT, UPDATE ON access_requests TO app_user;

-- Append-only tables: the app never rewrites history.
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ---------------------------------------------------------------- tenant resolution functions
-- Needed BEFORE tenant context exists. SECURITY DEFINER, owned by the BYPASSRLS role app_resolver,
-- and each returns nothing but a tenant id. This is the only place RLS is bypassed.
CREATE FUNCTION resolve_tenant_by_widget_key(p_key text, p_origin text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.tenant_id FROM widget_keys w JOIN tenants t ON t.id = w.tenant_id
  WHERE w.public_key = p_key AND w.status = 'active' AND t.status = 'active'
    AND p_origin = ANY (w.allowed_origins)
$$;

CREATE FUNCTION resolve_tenant_by_phone_number_id(p_phone_number_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.tenant_id FROM channel_connections c JOIN tenants t ON t.id = c.tenant_id
  WHERE c.phone_number_id = p_phone_number_id AND c.channel = 'whatsapp' AND t.status = 'active'
$$;

CREATE FUNCTION resolve_tenants_by_auth_user(p_auth_user_id uuid) RETURNS TABLE (tenant_id uuid, role user_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.tenant_id, u.role FROM tenant_users u JOIN tenants t ON t.id = u.tenant_id
  WHERE u.auth_user_id = p_auth_user_id AND t.status = 'active'
$$;

GRANT SELECT ON widget_keys, channel_connections, tenant_users, tenants TO app_resolver;
ALTER FUNCTION resolve_tenant_by_widget_key(text, text)   OWNER TO app_resolver;
ALTER FUNCTION resolve_tenant_by_phone_number_id(text)    OWNER TO app_resolver;
ALTER FUNCTION resolve_tenants_by_auth_user(uuid)         OWNER TO app_resolver;
REVOKE ALL ON FUNCTION resolve_tenant_by_widget_key(text, text), resolve_tenant_by_phone_number_id(text),
                       resolve_tenants_by_auth_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_widget_key(text, text), resolve_tenant_by_phone_number_id(text),
                          resolve_tenants_by_auth_user(uuid) TO app_user;
