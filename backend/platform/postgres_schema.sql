-- Private server-side account/document storage. Never add this schema to the
-- Supabase Data API's exposed schemas or grant it to browser-facing roles.
CREATE SCHEMA IF NOT EXISTS helpminths;
REVOKE ALL ON SCHEMA helpminths FROM PUBLIC;

CREATE OR REPLACE FUNCTION helpminths.json_valid(input TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
    PERFORM input::jsonb;
    RETURN TRUE;
EXCEPTION WHEN data_exception THEN
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION helpminths.json_extract(input TEXT, path TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE
        WHEN path = '$' THEN input::jsonb #>> '{}'
        WHEN left(path, 2) = '$.' THEN
            input::jsonb #>> string_to_array(substring(path FROM 3), '.')
        ELSE NULL
    END
$$;

CREATE OR REPLACE FUNCTION helpminths.json_type(input TEXT, path TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    value jsonb;
    kind TEXT;
BEGIN
    value := CASE WHEN path = '$' THEN input::jsonb
                  WHEN left(path, 2) = '$.' THEN input::jsonb #> string_to_array(substring(path FROM 3), '.')
                  ELSE NULL END;
    kind := jsonb_typeof(value);
    RETURN CASE kind
        WHEN 'number' THEN CASE WHEN value::TEXT ~ '^-?[0-9]+$' THEN 'integer' ELSE 'real' END
        WHEN 'string' THEN 'text'
        WHEN 'boolean' THEN value::TEXT
        ELSE kind
    END;
END;
$$;

CREATE OR REPLACE FUNCTION helpminths.json_each(input TEXT, path TEXT)
RETURNS TABLE(key TEXT, value TEXT) LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    node jsonb;
BEGIN
    node := CASE WHEN path = '$' THEN input::jsonb
                 WHEN left(path, 2) = '$.' THEN input::jsonb #> string_to_array(substring(path FROM 3), '.')
                 ELSE NULL END;
    IF jsonb_typeof(node) = 'array' THEN
        RETURN QUERY SELECT (entry.ordinality - 1)::TEXT, entry.item::TEXT
                     FROM jsonb_array_elements(node) WITH ORDINALITY AS entry(item, ordinality);
    ELSIF jsonb_typeof(node) = 'object' THEN
        RETURN QUERY SELECT entry.key, entry.value::TEXT FROM jsonb_each(node) AS entry;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION helpminths.json_array_length(input TEXT, path TEXT)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    node jsonb;
BEGIN
    node := CASE WHEN path = '$' THEN input::jsonb
                 WHEN left(path, 2) = '$.' THEN input::jsonb #> string_to_array(substring(path FROM 3), '.')
                 ELSE NULL END;
    IF node IS NULL THEN RETURN NULL; END IF;
    IF jsonb_typeof(node) = 'array' THEN RETURN jsonb_array_length(node); END IF;
    RETURN 0;
END;
$$;

-- A bound SQL text value remains a JSON string; it is not interpreted as JSON
-- source. This preserves the existing timestamp edits made with json_set().
-- Keep NULL handling inside the helper so a NULL replacement becomes JSON null
-- rather than making the entire document SQL NULL.
CREATE OR REPLACE FUNCTION helpminths.json_set_value(input TEXT, path TEXT, replacement JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN input IS NULL OR path IS NULL THEN NULL
        WHEN path = '$' THEN coalesce(replacement, 'null'::jsonb)::TEXT
        WHEN left(path, 2) = '$.' AND length(path) > 2
             AND path NOT LIKE '%..%' AND right(path, 1) <> '.' THEN
            jsonb_set(input::jsonb, string_to_array(substring(path FROM 3), '.'),
                      coalesce(replacement, 'null'::jsonb), TRUE)::TEXT
        ELSE input
    END
$$;

CREATE OR REPLACE FUNCTION helpminths.json_set(input TEXT, path TEXT, replacement TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT helpminths.json_set_value(input, path, to_jsonb(replacement))
$$;

CREATE OR REPLACE FUNCTION helpminths.json_set(input TEXT, path TEXT, replacement INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT helpminths.json_set_value(input, path, to_jsonb(replacement))
$$;

CREATE OR REPLACE FUNCTION helpminths.json_set(input TEXT, path TEXT, replacement BIGINT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT helpminths.json_set_value(input, path, to_jsonb(replacement))
$$;

CREATE OR REPLACE FUNCTION helpminths.json_set(input TEXT, path TEXT, replacement NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT helpminths.json_set_value(input, path, to_jsonb(replacement))
$$;

CREATE OR REPLACE FUNCTION helpminths.json_set(input TEXT, path TEXT, replacement DOUBLE PRECISION)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT helpminths.json_set_value(input, path, to_jsonb(replacement))
$$;

CREATE OR REPLACE FUNCTION helpminths.json_set(input TEXT, path TEXT, replacement BOOLEAN)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    -- Python's sqlite3 binds bool as integer 0/1.
    SELECT helpminths.json_set_value(input, path, to_jsonb(replacement::INTEGER))
$$;

-- All stored application timestamps are UTC ISO 8601 strings. These small
-- compatibility functions retain the existing Bangkok date grouping and range
-- filters without changing stored timestamps or authorization queries.
CREATE OR REPLACE FUNCTION helpminths.date(input TEXT, modifier TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    moment TIMESTAMP;
BEGIN
    moment := input::timestamptz AT TIME ZONE 'UTC';
    IF modifier IS NOT NULL AND modifier <> '' THEN
        IF modifier !~ '^[+-]?[0-9]+([.][0-9]+)? (hours?|days?|minutes?|seconds?)$' THEN
            RETURN NULL;
        END IF;
        moment := moment + modifier::interval;
    END IF;
    RETURN to_char(moment, 'YYYY-MM-DD');
EXCEPTION WHEN data_exception THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION helpminths.date(input TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT helpminths.date(input, '')
$$;

-- Earlier development copies used float8, whose precision cannot distinguish
-- the last microsecond of a Bangkok day from the following midnight. Change
-- only that obsolete return type; a NUMERIC installation remains idempotent.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = to_regprocedure('helpminths.julianday(text)')
          AND prorettype = 'double precision'::regtype
    ) THEN
        DROP FUNCTION helpminths.julianday(TEXT);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION helpminths.julianday(input TEXT)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
    RETURN extract(epoch FROM input::timestamptz) / 86400.0 + 2440587.5;
EXCEPTION WHEN data_exception THEN RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS helpminths.schema_version(
    version INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS helpminths.users(
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','reviewer','lab','student')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL,
    approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected')),
    requested_role TEXT NOT NULL DEFAULT 'lab' CHECK(requested_role IN ('admin','reviewer','lab','student')),
    approved_by TEXT REFERENCES helpminths.users(id),
    approved_at TEXT,
    is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_super_admin IN (0,1)),
    full_name TEXT,
    workplace TEXT,
    affiliation TEXT,
    phone TEXT,
    _sequence BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE,
    CONSTRAINT users_owner_valid CHECK(is_super_admin = 0 OR
        (role = 'admin' AND active = 1 AND approval_status = 'approved'))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase ON helpminths.users(lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner ON helpminths.users(is_super_admin) WHERE is_super_admin=1;

CREATE TABLE IF NOT EXISTS helpminths.sessions(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES helpminths.users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON helpminths.sessions(user_id);

CREATE TABLE IF NOT EXISTS helpminths.documents(
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    owner_id TEXT REFERENCES helpminths.users(id),
    data TEXT NOT NULL CHECK(helpminths.json_valid(data)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    _sequence BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE
);
CREATE INDEX IF NOT EXISTS documents_kind_created ON helpminths.documents(kind,created_at DESC);
CREATE INDEX IF NOT EXISTS documents_owner_kind ON helpminths.documents(owner_id,kind,deleted_at);

CREATE TABLE IF NOT EXISTS helpminths.audit_logs(
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    kind TEXT NOT NULL,
    document_id TEXT NOT NULL,
    actor_id TEXT REFERENCES helpminths.users(id),
    action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    before_data TEXT CHECK(before_data IS NULL OR helpminths.json_valid(before_data)),
    after_data TEXT CHECK(after_data IS NULL OR helpminths.json_valid(after_data))
);
CREATE INDEX IF NOT EXISTS audit_document ON helpminths.audit_logs(kind,document_id,id DESC);

CREATE OR REPLACE FUNCTION helpminths.reject_audit_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Audit records are append-only' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS audit_no_update ON helpminths.audit_logs;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON helpminths.audit_logs
    FOR EACH ROW EXECUTE FUNCTION helpminths.reject_audit_change();
DROP TRIGGER IF EXISTS audit_no_delete ON helpminths.audit_logs;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON helpminths.audit_logs
    FOR EACH ROW EXECUTE FUNCTION helpminths.reject_audit_change();

REVOKE ALL ON ALL TABLES IN SCHEMA helpminths FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA helpminths FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA helpminths FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON SCHEMA helpminths FROM %I', role_name);
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA helpminths FROM %I', role_name);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA helpminths FROM %I', role_name);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA helpminths FROM %I', role_name);
        END IF;
    END LOOP;
END;
$$;
