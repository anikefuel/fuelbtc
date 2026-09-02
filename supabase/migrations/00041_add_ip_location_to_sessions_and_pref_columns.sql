
-- Add IP/location columns to user_sessions if missing
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS ip_address   text,
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS country_code text;

-- Add all pref_ columns to user_security_preferences if missing
ALTER TABLE user_security_preferences
  ADD COLUMN IF NOT EXISTS pref_login           text NOT NULL DEFAULT 'any_strong',
  ADD COLUMN IF NOT EXISTS pref_withdrawal      text NOT NULL DEFAULT 'two_strong',
  ADD COLUMN IF NOT EXISTS pref_p2p_release     text NOT NULL DEFAULT 'any_strong',
  ADD COLUMN IF NOT EXISTS pref_security_change text NOT NULL DEFAULT 'two_strong',
  ADD COLUMN IF NOT EXISTS pref_new_address     text NOT NULL DEFAULT 'two_strong',
  ADD COLUMN IF NOT EXISTS pref_password_change text NOT NULL DEFAULT 'any_strong',
  ADD COLUMN IF NOT EXISTS pref_api_key         text NOT NULL DEFAULT 'any_strong',
  ADD COLUMN IF NOT EXISTS pref_large_transfer  text NOT NULL DEFAULT 'two_strong';

-- Ensure backup_codes has hash and used_at columns
ALTER TABLE backup_codes
  ADD COLUMN IF NOT EXISTS code_hash text,
  ADD COLUMN IF NOT EXISTS used_at   timestamptz;

-- Index for fast passkey lookup by credential_id
CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON passkeys(credential_id);

-- security_events alias if table doesn't exist (some installs use security_logs)
CREATE TABLE IF NOT EXISTS security_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  ip_address  text,
  device_info text,
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_events" ON security_events;
CREATE POLICY "users_own_events" ON security_events
  FOR SELECT USING (auth.uid() = user_id);

-- Ensure step_up_tokens has network column
ALTER TABLE step_up_tokens
  ADD COLUMN IF NOT EXISTS network text;
