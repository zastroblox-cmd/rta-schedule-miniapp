-- SECURITY DEFINER RPCs are internal backend operations.
-- The Mini App calls the Render API; the API uses the Supabase service_role key.
-- Remove direct execution from browser roles and retain explicit backend access.
DO $hardening$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      fn.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      fn.signature
    );
  END LOOP;
END
$hardening$;
