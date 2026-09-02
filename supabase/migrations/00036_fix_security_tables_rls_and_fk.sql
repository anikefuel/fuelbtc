
-- ══════════════════════════════════════════════════════════════════
-- 1. backup_codes – replace partial policies with full CRUD set
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can view own backup code metadata" ON public.backup_codes;
DROP POLICY IF EXISTS "Admins can view backup codes"           ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_select_own"               ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_insert_own"               ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_update_own"               ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_delete_own"               ON public.backup_codes;
DROP POLICY IF EXISTS "backup_codes_admin_all"                ON public.backup_codes;

CREATE POLICY "backup_codes_select_own"
  ON public.backup_codes FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "backup_codes_insert_own"
  ON public.backup_codes FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "backup_codes_update_own"
  ON public.backup_codes FOR UPDATE TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "backup_codes_delete_own"
  ON public.backup_codes FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "backup_codes_admin_all"
  ON public.backup_codes FOR ALL TO authenticated
  USING (get_user_role((SELECT auth.uid())) = 'admin'::user_role);

-- ══════════════════════════════════════════════════════════════════
-- 2. passkeys – replace partial policies with full CRUD set
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can view own passkeys"  ON public.passkeys;
DROP POLICY IF EXISTS "Admins full access passkeys"  ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_select_own"          ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_insert_own"          ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_update_own"          ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_delete_own"          ON public.passkeys;
DROP POLICY IF EXISTS "passkeys_admin_all"           ON public.passkeys;

CREATE POLICY "passkeys_select_own"
  ON public.passkeys FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "passkeys_insert_own"
  ON public.passkeys FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "passkeys_update_own"
  ON public.passkeys FOR UPDATE TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "passkeys_delete_own"
  ON public.passkeys FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "passkeys_admin_all"
  ON public.passkeys FOR ALL TO authenticated
  USING (get_user_role((SELECT auth.uid())) = 'admin'::user_role);

-- ══════════════════════════════════════════════════════════════════
-- 3. step_up_tokens – add user-level policies
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "step_up_tokens_select_own" ON public.step_up_tokens;
DROP POLICY IF EXISTS "step_up_tokens_insert_own" ON public.step_up_tokens;
DROP POLICY IF EXISTS "step_up_tokens_update_own" ON public.step_up_tokens;
DROP POLICY IF EXISTS "step_up_tokens_delete_own" ON public.step_up_tokens;

CREATE POLICY "step_up_tokens_select_own"
  ON public.step_up_tokens FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "step_up_tokens_insert_own"
  ON public.step_up_tokens FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "step_up_tokens_update_own"
  ON public.step_up_tokens FOR UPDATE TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "step_up_tokens_delete_own"
  ON public.step_up_tokens FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ══════════════════════════════════════════════════════════════════
-- 4. Re-point all security-table FKs to auth.users(id)
--    (they currently point to profiles(id); while profiles.id = auth.users.id
--     the explicit FK to auth.users removes any ambiguity)
-- ══════════════════════════════════════════════════════════════════
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  -- backup_codes
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public' AND tc.table_name = 'backup_codes'
    AND ccu.table_name = 'profiles';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.backup_codes DROP CONSTRAINT %I', fk_name);
    ALTER TABLE public.backup_codes
      ADD CONSTRAINT backup_codes_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- passkeys
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public' AND tc.table_name = 'passkeys'
    AND ccu.table_name = 'profiles';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.passkeys DROP CONSTRAINT %I', fk_name);
    ALTER TABLE public.passkeys
      ADD CONSTRAINT passkeys_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- security_logs
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public' AND tc.table_name = 'security_logs'
    AND ccu.table_name = 'profiles';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.security_logs DROP CONSTRAINT %I', fk_name);
    ALTER TABLE public.security_logs
      ADD CONSTRAINT security_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- step_up_tokens
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public' AND tc.table_name = 'step_up_tokens'
    AND ccu.table_name = 'profiles';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.step_up_tokens DROP CONSTRAINT %I', fk_name);
    ALTER TABLE public.step_up_tokens
      ADD CONSTRAINT step_up_tokens_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$$;
