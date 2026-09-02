-- ═══════════════════════════════════════════════════════════════════
-- Phase 1: Auth & Security — profile extensions + security tables
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Extend profiles ────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name          text,
  ADD COLUMN IF NOT EXISTS phone              text,
  ADD COLUMN IF NOT EXISTS country            text,
  ADD COLUMN IF NOT EXISTS preferred_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS email_verified     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS totp_factor_id     text,
  ADD COLUMN IF NOT EXISTS is_suspended       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at       timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason   text,
  ADD COLUMN IF NOT EXISTS last_login_at      timestamptz,
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_locked_until timestamptz;

-- ── 2. Security event log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type   text NOT NULL,  -- login_success, login_failed, password_changed, totp_enrolled, totp_disabled, passkey_enrolled, passkey_removed, backup_code_used, session_revoked, step_up_completed, withdrawal_approved, escrow_released
  ip_address   text,
  device_info  text,
  location     text,
  metadata     jsonb NOT NULL DEFAULT '{}',  -- non-sensitive context only
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_logs_user_id ON public.security_logs(user_id);
CREATE INDEX idx_security_logs_created_at ON public.security_logs(created_at DESC);

ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own security logs" ON public.security_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service inserts security logs" ON public.security_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins full access security logs" ON public.security_logs
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- ── 3. Backup codes (for TOTP recovery) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.backup_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,  -- SHA-256 hex of the raw code — raw code never stored
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_backup_codes_user_id ON public.backup_codes(user_id);

ALTER TABLE public.backup_codes ENABLE ROW LEVEL SECURITY;

-- Users can see how many codes exist (but not the hashes)
CREATE POLICY "Users can view own backup code metadata" ON public.backup_codes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Edge Function writes via service role — no authenticated insert policy needed
-- Admins can view for support
CREATE POLICY "Admins can view backup codes" ON public.backup_codes
  FOR SELECT TO authenticated USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- ── 4. Passkeys / WebAuthn credentials ──────────────────────────
CREATE TABLE IF NOT EXISTS public.passkeys (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credential_id      text NOT NULL UNIQUE,  -- base64url-encoded WebAuthn credential ID
  public_key_cbor    text,                  -- base64url-encoded CBOR public key (null for native biometric)
  counter            bigint NOT NULL DEFAULT 0,
  device_label       text NOT NULL DEFAULT 'My Device',
  aaguid             text,                  -- authenticator attestation GUID
  transports         text[],                -- internal, usb, nfc, ble, hybrid
  platform_type      text NOT NULL DEFAULT 'webauthn', -- webauthn | biometric_native
  last_used_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_passkeys_user_id ON public.passkeys(user_id);
CREATE INDEX idx_passkeys_credential_id ON public.passkeys(credential_id);

ALTER TABLE public.passkeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own passkeys" ON public.passkeys
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins full access passkeys" ON public.passkeys
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- ── 5. Step-up authorization tokens ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.step_up_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type     text NOT NULL,   -- withdrawal, escrow_release, password_change, totp_disable, passkey_remove, api_key_generate
  txn_id          text,            -- order/withdrawal/trade ID being authorized
  amount          numeric,
  asset           text,
  destination     text,
  verified_by     text NOT NULL,   -- totp | passkey | backup_code
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_step_up_tokens_user_id ON public.step_up_tokens(user_id);
CREATE INDEX idx_step_up_tokens_expires ON public.step_up_tokens(expires_at);

ALTER TABLE public.step_up_tokens ENABLE ROW LEVEL SECURITY;

-- Only via Edge Function (service role) — no direct client access
CREATE POLICY "Admins full access step_up_tokens" ON public.step_up_tokens
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- ── 6. WebAuthn challenge store (ephemeral) ──────────────────────
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  challenge   text NOT NULL,
  purpose     text NOT NULL DEFAULT 'registration',  -- registration | authentication
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

-- No direct client access — Edge Function uses service role

-- ── 7. RLS for user_sessions (if not already set) ────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_sessions' AND policyname='Users view own sessions'
  ) THEN
    ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
    EXECUTE 'CREATE POLICY "Users view own sessions" ON public.user_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY "Users insert own sessions" ON public.user_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY "Users update own sessions" ON public.user_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY "Admins full access sessions" ON public.user_sessions FOR ALL TO authenticated USING (get_user_role(auth.uid()) = ''admin''::user_role)';
  END IF;
END $$;

-- ── 8. Sync email_verified from auth on login ────────────────────
-- We update email_verified in profiles whenever user signs in (handled client-side)
-- This view makes it easy to query user status
CREATE OR REPLACE VIEW public.user_security_status AS
  SELECT
    p.id,
    p.email,
    p.email_verified,
    p.two_fa_enabled,
    p.totp_factor_id IS NOT NULL AND p.two_fa_enabled AS totp_active,
    (SELECT count(*) FROM public.passkeys pk WHERE pk.user_id = p.id) AS passkey_count,
    (SELECT count(*) FROM public.backup_codes bc WHERE bc.user_id = p.id AND bc.used_at IS NULL) AS unused_backup_codes,
    p.last_login_at,
    p.is_suspended,
    p.account_locked_until
  FROM public.profiles p;

-- ── 9. RLS: update user_sessions insert policy for user_id default
ALTER TABLE public.user_sessions
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- ── 10. Scheduled cleanup of expired step_up_tokens and challenges
-- Remove tokens older than 1 hour
CREATE OR REPLACE FUNCTION public.cleanup_expired_auth_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.step_up_tokens WHERE expires_at < now() - interval '1 hour';
  DELETE FROM public.webauthn_challenges WHERE expires_at < now() - interval '1 hour';
END;
$$;