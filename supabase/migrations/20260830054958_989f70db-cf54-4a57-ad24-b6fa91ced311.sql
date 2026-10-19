-- TRUNCATE bypasses RLS entirely, and TRIGGER/MAINTAIN/REFERENCES are never needed by app roles.
-- Revoke these structural privileges from anon and authenticated on every public table.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;