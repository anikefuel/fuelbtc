
-- ─────────────────────────────────────────────────────────────────────────────
-- Definitive security-table hardening migration
-- Fixes: RLS on backup_codes / passkeys (re-assert), enable RLS on
--        security_logs / trusted_devices / user_security_settings if they exist,
--        add missing FK → auth.users where absent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── backup_codes ──────────────────────────────────────────────────────────────
ALTER TABLE public.backup_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backup_codes_select_own"  ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_insert_own"  ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_update_own"  ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_delete_own"  ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_admin_all"   ON public.backup_codes;

CREATE POLICY "backup_codes_select_own" ON public.backup_codes
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "backup_codes_insert_own" ON public.backup_codes
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "backup_codes_update_own" ON public.backup_codes
  FOR UPDATE TO authenticated
  USING      ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "backup_codes_delete_own" ON public.backup_codes
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Deny anonymous access explicitly
DROP POLICY IF EXISTS "backup_codes_deny_anon" ON public.backup_codes;
-- (RLS enabled with no anon policy already denies; explicit denial not needed)

-- ── passkeys ──────────────────────────────────────────────────────────────────
ALTER TABLE public.passkeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "passkeys_select_own"  ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_insert_own"  ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_update_own"  ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_delete_own"  ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_admin_all"   ON public.passkeys;

CREATE POLICY "passkeys_select_own" ON public.passkeys
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "passkeys_insert_own" ON public.passkeys
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "passkeys_update_own" ON public.passkeys
  FOR UPDATE TO authenticated
  USING      ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "passkeys_delete_own" ON public.passkeys
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Unique credential_id across all users (prevent duplicate passkeys)
ALTER TABLE public.passkeys
  DROP CONSTRAINT IF EXISTS passkeys_credential_id_unique;
ALTER TABLE public.passkeys
  ADD CONSTRAINT passkeys_credential_id_unique UNIQUE (credential_id);

-- ── step_up_tokens ────────────────────────────────────────────────────────────
ALTER TABLE public.step_up_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "step_up_tokens_select_own" ON public.step_up_tokens;
DROP POLICY IF EXISTS "step_up_tokens_insert_own" ON public.step_up_tokens;
DROP POLICY IF EXISTS "step_up_tokens_update_own" ON public.step_up_tokens;
DROP POLICY IF EXISTS "step_up_tokens_delete_own" ON public.step_up_tokens;

CREATE POLICY "step_up_tokens_select_own" ON public.step_up_tokens
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "step_up_tokens_insert_own" ON public.step_up_tokens
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "step_up_tokens_update_own" ON public.step_up_tokens
  FOR UPDATE TO authenticated
  USING      ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "step_up_tokens_delete_own" ON public.step_up_tokens
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ── security_logs (if exists) ─────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='security_logs') THEN
    EXECUTE 'ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "security_logs_select_own" ON public.security_logs';
    EXECUTE 'DROP POLICY IF EXISTS "security_logs_insert_own" ON public.security_logs';
    EXECUTE $pol$
      CREATE POLICY "security_logs_select_own" ON public.security_logs
        FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id)
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "security_logs_insert_own" ON public.security_logs
        FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id)
    $pol$;
  END IF;
END $$;

-- ── trusted_devices (if exists) ───────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trusted_devices') THEN
    EXECUTE 'ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "trusted_devices_select_own" ON public.trusted_devices';
    EXECUTE 'DROP POLICY IF EXISTS "trusted_devices_insert_own" ON public.trusted_devices';
    EXECUTE 'DROP POLICY IF EXISTS "trusted_devices_delete_own" ON public.trusted_devices';
    EXECUTE $pol$
      CREATE POLICY "trusted_devices_select_own" ON public.trusted_devices
        FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id)
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "trusted_devices_insert_own" ON public.trusted_devices
        FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id)
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "trusted_devices_delete_own" ON public.trusted_devices
        FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id)
    $pol$;
  END IF;
END $$;

-- ── user_security_settings (if exists) ────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_security_settings') THEN
    EXECUTE 'ALTER TABLE public.user_security_settings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "user_security_settings_own" ON public.user_security_settings';
    EXECUTE $pol$
      CREATE POLICY "user_security_settings_own" ON public.user_security_settings
        FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id)
        WITH CHECK ((SELECT auth.uid()) = user_id)
    $pol$;
  END IF;
END $$;
