
-- Phase 16: Add Prembly as default KYC provider (replaces Dojah as priority-1)
-- Add retry_limit column to kyc_providers if missing
ALTER TABLE kyc_providers
  ADD COLUMN IF NOT EXISTS retry_limit INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'production';

-- Add prembly-specific columns to kyc_attempts
ALTER TABLE kyc_attempts
  ADD COLUMN IF NOT EXISTS config_id        TEXT,
  ADD COLUMN IF NOT EXISTS widget_key       TEXT,
  ADD COLUMN IF NOT EXISTS prembly_token    TEXT,
  ADD COLUMN IF NOT EXISTS kyc_level        TEXT;

-- Index for webhook token lookup
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_prembly_token ON kyc_attempts(prembly_token)
  WHERE prembly_token IS NOT NULL;

-- Index for external_reference lookup
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_external_ref ON kyc_attempts(external_reference)
  WHERE external_reference IS NOT NULL;

-- Upsert Prembly as priority-1
INSERT INTO kyc_providers (
  provider_name, display_name, enabled, priority, environment,
  supported_countries, supported_doc_types, auto_fallback,
  retry_limit, config
) VALUES (
  'prembly',
  'Prembly IdentityPass',
  true,
  1,
  'sandbox',
  ARRAY[]::text[],
  ARRAY['passport','national_id','drivers_licence','residence_permit']::text[],
  true,
  3,
  jsonb_build_object(
    'integration_mode', 'widget',
    'base_widget_url',  'https://kyc.prembly.com',
    'environment',      'sandbox',
    'config_id',        '98e264b6-62de-47bc-9896-fdf299d9c612',
    'widget_key',       'wdgt_86138e502e7f4430be3da2aaac507193'
  )
)
ON CONFLICT (provider_name) DO UPDATE SET
  priority    = EXCLUDED.priority,
  environment = EXCLUDED.environment,
  enabled     = EXCLUDED.enabled,
  config      = EXCLUDED.config,
  updated_at  = now();

-- Move Dojah to priority-2 (fallback)
UPDATE kyc_providers
SET priority    = 2,
    environment = 'production',
    updated_at  = now()
WHERE provider_name = 'dojah';

-- Disable Sumsub (was legacy priority-2)
UPDATE kyc_providers
SET enabled    = false,
    priority   = 3,
    updated_at = now()
WHERE provider_name = 'sumsub';
