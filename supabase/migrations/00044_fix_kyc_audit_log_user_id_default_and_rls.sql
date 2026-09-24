-- Fix 1: Add DEFAULT auth.uid() to kyc_audit_log.user_id so client-side inserts
-- (without explicit user_id) work correctly via RLS. This prevents the
-- "invalid input syntax for type uuid" error caused by missing user_id on insert.
ALTER TABLE public.kyc_audit_log
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Fix 2: Add INSERT policy for authenticated users on kyc_audit_log
-- (was missing — only SELECT policy existed for users)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'kyc_audit_log'
      AND policyname = 'users_insert_own_audit'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "users_insert_own_audit"
        ON public.kyc_audit_log
        FOR INSERT TO authenticated
        WITH CHECK (auth.uid() = user_id)
    $policy$;
  END IF;
END $$;