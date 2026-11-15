-- Defence for hosted Postgres that auto-exposes the public schema over HTTP
-- (e.g. Supabase's Data API / PostgREST). AteAnne never uses that API; all
-- access goes through the app's authorised server routes.
--
-- 1. Enable Row Level Security with NO policies on every AteAnne table, so
--    API roles can read/write nothing. The app connects as the table owner,
--    which bypasses RLS (we do not use FORCE), so the app is unaffected.
-- 2. If Supabase's anon/authenticated roles exist, revoke their privileges.
-- Harmless on plain PostgreSQL / Neon.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', current_schema(), t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon', current_schema());
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon', current_schema());
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM anon', current_schema());
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM authenticated', current_schema());
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM authenticated', current_schema());
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM authenticated', current_schema());
  END IF;
END $$;
