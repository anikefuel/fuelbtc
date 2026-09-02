
-- ============================================================
-- Fix 1: kyc_attempts — add external_reference text column
-- ============================================================
ALTER TABLE kyc_attempts
  ADD COLUMN IF NOT EXISTS external_reference TEXT;

-- ============================================================
-- Fix 2: kyc_providers — ensure updated_by is TEXT
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='kyc_providers' AND column_name='updated_by'
      AND data_type='uuid'
  ) THEN
    ALTER TABLE kyc_providers DROP CONSTRAINT IF EXISTS kyc_providers_updated_by_fkey;
    ALTER TABLE kyc_providers ALTER COLUMN updated_by TYPE TEXT USING updated_by::TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='kyc_providers' AND column_name='updated_by'
  ) THEN
    ALTER TABLE kyc_providers ADD COLUMN updated_by TEXT;
  END IF;
END $$;

-- ============================================================
-- Fix 3: profiles trigger — auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_uid TEXT;
BEGIN
  new_uid := 'EXX' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  INSERT INTO public.profiles (
    id, uid, email, username, full_name,
    kyc_tier, kyc_status, role,
    created_at, updated_at
  ) VALUES (
    NEW.id,
    new_uid,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    'tier0'::kyc_tier,
    'not_started'::kyc_status,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'user'::user_role),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles for existing auth users without a profile
INSERT INTO public.profiles (id, uid, email, username, full_name, kyc_tier, kyc_status, role, created_at, updated_at)
SELECT
  u.id,
  'EXX' || substr(replace(u.id::text, '-', ''), 1, 8),
  u.email,
  COALESCE(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1), 'user'),
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
  'tier0'::kyc_tier,
  'not_started'::kyc_status,
  'user'::user_role,
  u.created_at,
  NOW()
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Fix 4: is_admin() helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ============================================================
-- Fix 5: RLS on profiles
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_admin_all ON profiles;
DROP POLICY IF EXISTS profiles_user_own  ON profiles;
CREATE POLICY profiles_user_own ON profiles
  FOR ALL USING (auth.uid() = id);
CREATE POLICY profiles_admin_all ON profiles
  FOR ALL USING (public.is_admin());

-- ============================================================
-- Fix 6: RLS on kyc_attempts
-- ============================================================
ALTER TABLE kyc_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kyc_attempts_user_own    ON kyc_attempts;
DROP POLICY IF EXISTS kyc_attempts_admin_all   ON kyc_attempts;
DROP POLICY IF EXISTS kyc_attempts_service_all ON kyc_attempts;
CREATE POLICY kyc_attempts_user_own ON kyc_attempts
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY kyc_attempts_admin_all ON kyc_attempts
  FOR ALL USING (public.is_admin());

-- ============================================================
-- Fix 7: RLS on kyc_submissions
-- ============================================================
ALTER TABLE kyc_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kyc_submissions_user_own  ON kyc_submissions;
DROP POLICY IF EXISTS kyc_submissions_admin_all ON kyc_submissions;
CREATE POLICY kyc_submissions_user_own ON kyc_submissions
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY kyc_submissions_admin_all ON kyc_submissions
  FOR ALL USING (public.is_admin());

-- ============================================================
-- Fix 8: RLS on kyc_providers + kyc_settings
-- ============================================================
ALTER TABLE kyc_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kyc_providers_read_all    ON kyc_providers;
DROP POLICY IF EXISTS kyc_providers_admin_write ON kyc_providers;
CREATE POLICY kyc_providers_read_all ON kyc_providers
  FOR SELECT USING (true);
CREATE POLICY kyc_providers_admin_write ON kyc_providers
  FOR ALL USING (public.is_admin());

ALTER TABLE kyc_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kyc_settings_read_all    ON kyc_settings;
DROP POLICY IF EXISTS kyc_settings_admin_write ON kyc_settings;
CREATE POLICY kyc_settings_read_all ON kyc_settings
  FOR SELECT USING (true);
CREATE POLICY kyc_settings_admin_write ON kyc_settings
  FOR ALL USING (public.is_admin());

-- ============================================================
-- Fix 9: RLS on withdrawals
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='withdrawals') THEN
    EXECUTE 'ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS withdrawals_user_own  ON withdrawals';
    EXECUTE 'DROP POLICY IF EXISTS withdrawals_admin_all ON withdrawals';
    EXECUTE 'CREATE POLICY withdrawals_user_own ON withdrawals FOR ALL USING (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY withdrawals_admin_all ON withdrawals FOR ALL USING (public.is_admin())';
  END IF;
END $$;

-- ============================================================
-- Fix 10: RLS on p2p_disputes (raised_by column, not initiator_id)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='p2p_disputes') THEN
    EXECUTE 'ALTER TABLE p2p_disputes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS p2p_disputes_parties  ON p2p_disputes';
    EXECUTE 'DROP POLICY IF EXISTS p2p_disputes_admin_all ON p2p_disputes';
    EXECUTE 'CREATE POLICY p2p_disputes_parties ON p2p_disputes FOR ALL USING (auth.uid() = raised_by)';
    EXECUTE 'CREATE POLICY p2p_disputes_admin_all ON p2p_disputes FOR ALL USING (public.is_admin())';
  END IF;
END $$;

-- ============================================================
-- Fix 11: get_admin_stats() SECURITY DEFINER RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_users          BIGINT;
  v_profiles            BIGINT;
  v_pending_kyc         BIGINT;
  v_pending_withdrawals BIGINT;
  v_open_disputes       BIGINT;
  v_kyc_attempts        BIGINT;
  v_kyc_verified        BIGINT;
  v_kyc_failed          BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  SELECT COUNT(*) INTO v_auth_users   FROM auth.users;
  SELECT COUNT(*) INTO v_profiles     FROM public.profiles;
  SELECT COUNT(*) INTO v_pending_kyc  FROM public.kyc_attempts
    WHERE status IN ('in_progress','submitted','pending_review','manual_review');
  SELECT COUNT(*) INTO v_kyc_attempts FROM public.kyc_attempts;
  SELECT COUNT(*) INTO v_kyc_verified FROM public.kyc_attempts WHERE status = 'verified';
  SELECT COUNT(*) INTO v_kyc_failed   FROM public.kyc_attempts WHERE status = 'failed';
  BEGIN
    SELECT COUNT(*) INTO v_pending_withdrawals FROM public.withdrawals
      WHERE status IN ('pending','under_review');
  EXCEPTION WHEN undefined_table THEN v_pending_withdrawals := 0;
  END;
  BEGIN
    SELECT COUNT(*) INTO v_open_disputes FROM public.p2p_disputes WHERE status = 'open';
  EXCEPTION WHEN undefined_table THEN v_open_disputes := 0;
  END;
  RETURN json_build_object(
    'totalUsers',           v_auth_users,
    'profileCount',         v_profiles,
    'pendingKyc',           v_pending_kyc,
    'pendingWithdrawals',   v_pending_withdrawals,
    'openDisputes',         v_open_disputes,
    'kycAttempts',          v_kyc_attempts,
    'kycVerified',          v_kyc_verified,
    'kycFailed',            v_kyc_failed,
    'profilesMissingAuth',  v_auth_users - v_profiles
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;
