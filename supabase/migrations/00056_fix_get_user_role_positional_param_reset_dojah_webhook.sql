
-- ============================================================
-- Fix 1: get_user_role — use $1 to avoid name collision with
-- profiles.uid TEXT column. Cannot rename param (policies depend on it).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_role(uid UUID)
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = $1 LIMIT 1;
$$;

-- ============================================================
-- Fix 2: reset Dojah health — clear spurious 404 failures
-- ============================================================
UPDATE kyc_providers
SET health_status = 'healthy', failure_count = 0,
    last_error = NULL, last_error_at = NULL, updated_at = NOW()
WHERE provider_name = 'dojah';

-- ============================================================
-- Fix 3: ensure Dojah row exists with correct widget config
-- ============================================================
INSERT INTO kyc_providers (
  provider_name, display_name, enabled, priority,
  supported_countries, auto_fallback, manual_selection,
  health_status, failure_count, config, updated_at
) VALUES (
  'dojah', 'Dojah EasyOnboard', true, 1, '{}', true, false, 'healthy', 0,
  '{"widget_id":"6a5b12349ff90fe054784334","base_widget_url":"https://identity.dojah.io","hosted_url":"https://identity.dojah.io?widget_id=6a5b12349ff90fe054784334","integration_mode":"hosted"}',
  NOW()
)
ON CONFLICT (provider_name) DO UPDATE SET
  config     = kyc_providers.config || '{"widget_id":"6a5b12349ff90fe054784334","base_widget_url":"https://identity.dojah.io","hosted_url":"https://identity.dojah.io?widget_id=6a5b12349ff90fe054784334","integration_mode":"hosted"}',
  updated_at = NOW();

-- ============================================================
-- Fix 4: webhook_audit_log for admin visibility
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT NOT NULL,
  reference_id TEXT,
  event_type   TEXT,
  status       TEXT NOT NULL DEFAULT 'received',
  error        TEXT,
  raw_payload  JSONB,
  attempt_id   UUID REFERENCES kyc_attempts(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_audit_log_created   ON webhook_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_audit_log_reference ON webhook_audit_log (reference_id);
ALTER TABLE webhook_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_audit_admin ON webhook_audit_log;
CREATE POLICY webhook_audit_admin ON webhook_audit_log FOR ALL USING (public.is_admin());

-- ============================================================
-- Fix 5: lookup indexes and webhook event columns
-- ============================================================
ALTER TABLE kyc_provider_events
  ADD COLUMN IF NOT EXISTS raw_payload  JSONB,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_kyc_provider_events_ref_type ON kyc_provider_events (reference_id, event_type);
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_reference_id    ON kyc_attempts (reference_id);
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_provider_ref    ON kyc_attempts (provider_reference);
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_external_ref    ON kyc_attempts (external_reference);
