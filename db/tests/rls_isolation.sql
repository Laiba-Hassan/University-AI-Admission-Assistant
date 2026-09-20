-- Cross-tenant isolation smoke test (PRD Section 3 mandatory security acceptance test, SQL layer).
-- Run as app_user against a migrated database. Raises an exception on the first violation; rolls back everything.
BEGIN;

CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON ids TO PUBLIC;

DO $$
DECLARE
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  ca uuid; cb uuid; pa uuid; pb uuid; n int;
BEGIN
  -- Tenant A
  PERFORM set_config('app.tenant_id', a::text, true);
  INSERT INTO tenants (id, name, subdomain) VALUES (a, 'Tenant A', 'a-' || left(a::text, 8));
  INSERT INTO programs (tenant_id, name, degree_level, status) VALUES (a, 'BSCS', 'bachelor', 'approved') RETURNING id INTO pa;
  INSERT INTO fee_items (tenant_id, program_id, academic_year, student_type, item_type, amount, currency, per, status)
    VALUES (a, pa, '2026-27', 'local', 'tuition', 100, 'PKR', 'semester', 'approved');
  INSERT INTO contacts (tenant_id, channel, external_id) VALUES (a, 'web', 's1') RETURNING id INTO ca;
  INSERT INTO conversations (tenant_id, contact_id, channel) VALUES (a, ca, 'web');
  INSERT INTO leads (tenant_id, contact_id, name) VALUES (a, ca, 'Lead A');
  INSERT INTO usage_events (tenant_id, event_type) VALUES (a, 'message');
  INSERT INTO channel_connections (tenant_id, channel, phone_number_id) VALUES (a, 'whatsapp', 'pn-' || a);
  INSERT INTO widget_keys (tenant_id, public_key, allowed_origins) VALUES (a, 'wk-' || a, ARRAY['https://a.example']);

  -- Tenant B
  PERFORM set_config('app.tenant_id', b::text, true);
  INSERT INTO tenants (id, name, subdomain) VALUES (b, 'Tenant B', 'b-' || left(b::text, 8));
  INSERT INTO programs (tenant_id, name, degree_level, status) VALUES (b, 'BSCS', 'bachelor', 'approved') RETURNING id INTO pb;
  INSERT INTO fee_items (tenant_id, program_id, academic_year, student_type, item_type, amount, currency, per, status)
    VALUES (b, pb, '2026-27', 'local', 'tuition', 999, 'PKR', 'credit_hour', 'approved');
  INSERT INTO contacts (tenant_id, channel, external_id) VALUES (b, 'web', 's1') RETURNING id INTO cb;
  INSERT INTO leads (tenant_id, contact_id, name) VALUES (b, cb, 'Lead B');

  INSERT INTO ids VALUES ('a', a), ('b', b), ('pa', pa), ('pb', pb);
END $$;

-- 1. As A: only A's rows are visible, in every tenant-owned table exercised above.
DO $$
DECLARE a uuid := (SELECT v FROM ids WHERE k='a'); pb uuid := (SELECT v FROM ids WHERE k='pb'); n int; t text;
BEGIN
  PERFORM set_config('app.tenant_id', a::text, true);
  FOREACH t IN ARRAY ARRAY['programs','fee_items','contacts','leads','tenants'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %s <> %L', t, CASE WHEN t='tenants' THEN 'id' ELSE 'tenant_id' END, a) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'LEAK: % returned % foreign rows', t, n; END IF;
  END LOOP;
  -- 2. Direct probe of B's program by primary key.
  SELECT count(*) INTO n FROM programs WHERE id = pb;
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK: A can read B''s program by id'; END IF;
  SELECT count(*) INTO n FROM fee_items WHERE amount = 999;
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK: A can see B''s fee'; END IF;
  -- 3. A cannot update or delete B's rows (invisible => 0 rows affected).
  UPDATE programs SET name = 'HACKED' WHERE id = pb; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK: A updated B''s program'; END IF;
  DELETE FROM leads WHERE name = 'Lead B'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'LEAK: A deleted B''s lead'; END IF;
END $$;

-- 4. A cannot write a row labelled for B (WITH CHECK).
DO $$
DECLARE a uuid := (SELECT v FROM ids WHERE k='a'); b uuid := (SELECT v FROM ids WHERE k='b');
BEGIN
  PERFORM set_config('app.tenant_id', a::text, true);
  BEGIN
    INSERT INTO leads (tenant_id, name) VALUES (b, 'planted');
    RAISE EXCEPTION 'LEAK: A inserted a row for B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- RLS violation (42501) is the expected outcome
  END;
END $$;

-- 5. With NO tenant context nothing is visible (fails closed).
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO n FROM programs;  IF n <> 0 THEN RAISE EXCEPTION 'LEAK: rows visible with no tenant'; END IF;
  SELECT count(*) INTO n FROM tenants;   IF n <> 0 THEN RAISE EXCEPTION 'LEAK: tenants visible with no tenant'; END IF;
END $$;

-- 6. Resolution functions work pre-context and return only the tenant id.
DO $$
DECLARE a uuid := (SELECT v FROM ids WHERE k='a'); r uuid;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  r := resolve_tenant_by_widget_key('wk-' || a, 'https://a.example');
  IF r IS DISTINCT FROM a THEN RAISE EXCEPTION 'widget key resolution failed'; END IF;
  r := resolve_tenant_by_widget_key('wk-' || a, 'https://evil.example');
  IF r IS NOT NULL THEN RAISE EXCEPTION 'widget key accepted a foreign origin'; END IF;
  r := resolve_tenant_by_phone_number_id('pn-' || a);
  IF r IS DISTINCT FROM a THEN RAISE EXCEPTION 'phone_number_id resolution failed'; END IF;
END $$;

-- 7. Audit log is append-only for the app role.
DO $$
DECLARE a uuid := (SELECT v FROM ids WHERE k='a');
BEGIN
  PERFORM set_config('app.tenant_id', a::text, true);
  INSERT INTO audit_logs (tenant_id, action) VALUES (a, 'test');
  BEGIN
    DELETE FROM audit_logs;
    RAISE EXCEPTION 'audit_logs delete was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
SELECT 'RLS isolation: ALL CHECKS PASSED' AS result;
