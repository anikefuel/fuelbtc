
-- ── 1. Extend profiles with full address & identity fields ──────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nationality        text,
  ADD COLUMN IF NOT EXISTS state_province     text,
  ADD COLUMN IF NOT EXISTS city               text,
  ADD COLUMN IF NOT EXISTS street_address     text,
  ADD COLUMN IF NOT EXISTS apt_suite          text,
  ADD COLUMN IF NOT EXISTS postal_code        text,
  ADD COLUMN IF NOT EXISTS date_of_birth      date,
  ADD COLUMN IF NOT EXISTS phone_country_code text DEFAULT '+1';

-- ── 2. user_security_preferences ──────────────────────────────────────────
-- Stores per-user per-action security method configuration
CREATE TABLE IF NOT EXISTS public.user_security_preferences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- enabled method flags
  totp_enabled       boolean NOT NULL DEFAULT false,
  passkey_enabled    boolean NOT NULL DEFAULT false,
  email_otp_enabled  boolean NOT NULL DEFAULT true,
  backup_codes_enabled boolean NOT NULL DEFAULT true,
  -- per-action preferences: 'totp'|'passkey'|'email_otp'|'any_strong'|'two_strong'|'all_enabled'
  pref_login             text NOT NULL DEFAULT 'any_strong',
  pref_withdrawal        text NOT NULL DEFAULT 'two_strong',
  pref_p2p_release       text NOT NULL DEFAULT 'any_strong',
  pref_security_change   text NOT NULL DEFAULT 'two_strong',
  pref_new_address       text NOT NULL DEFAULT 'two_strong',
  pref_password_change   text NOT NULL DEFAULT 'any_strong',
  pref_api_key           text NOT NULL DEFAULT 'any_strong',
  pref_large_transfer    text NOT NULL DEFAULT 'two_strong',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_security_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sec_prefs_select_own" ON public.user_security_preferences
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "sec_prefs_insert_own" ON public.user_security_preferences
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "sec_prefs_update_own" ON public.user_security_preferences
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "sec_prefs_admin_all" ON public.user_security_preferences
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');

-- ── 3. email_verification_challenges ──────────────────────────────────────
-- Short-lived email OTP challenges
CREATE TABLE IF NOT EXISTS public.email_verification_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  code_hash    text NOT NULL,          -- SHA-256 of the 6-digit code
  purpose      text NOT NULL,          -- 'withdrawal'|'new_address'|'security_change'|'login'|'recovery'
  metadata     jsonb NOT NULL DEFAULT '{}',
  attempts     int  NOT NULL DEFAULT 0,
  used_at      timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_challenges_user_idx ON public.email_verification_challenges(user_id, purpose);
CREATE INDEX IF NOT EXISTS email_challenges_expires_idx ON public.email_verification_challenges(expires_at);

ALTER TABLE public.email_verification_challenges ENABLE ROW LEVEL SECURITY;

-- Users can only read their own challenges (no INSERT from client — server-side only)
CREATE POLICY "email_chal_select_own" ON public.email_verification_challenges
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
-- Admin full access
CREATE POLICY "email_chal_admin_all" ON public.email_verification_challenges
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');

-- ── 4. Fix avatar storage RLS ──────────────────────────────────────────────
-- The RLS check expects user_id as the FIRST path component: {user_id}/avatar.jpg
-- Drop old policy that checked for foldername
DROP POLICY IF EXISTS "avatars_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_read"  ON storage.objects;

CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ── 5. trusted_devices (for new-device detection) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  device_name  text,
  browser      text,
  os           text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  trusted_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint)
);

ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trusted_devices_own" ON public.trusted_devices
  FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
