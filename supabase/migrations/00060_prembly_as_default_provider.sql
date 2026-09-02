
-- 1. Add is_default column to kyc_providers (single source of truth)
ALTER TABLE kyc_providers
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- 2. Ensure exactly one default: Prembly = true, everyone else = false
UPDATE kyc_providers SET is_default = false;
UPDATE kyc_providers SET is_default = true  WHERE provider_name = 'prembly';

-- 3. Enforce uniqueness — only one provider may be default at a time
CREATE UNIQUE INDEX IF NOT EXISTS kyc_providers_one_default
  ON kyc_providers (is_default)
  WHERE is_default = true;

-- 4. Migrate the stale kyc_settings row: default_provider → prembly
UPDATE kyc_settings
  SET value = '"prembly"'::jsonb,
      updated_at = now()
  WHERE key = 'default_provider';

-- Insert if it doesn't exist yet
INSERT INTO kyc_settings (key, value, updated_at)
  VALUES ('default_provider', '"prembly"'::jsonb, now())
  ON CONFLICT (key) DO UPDATE
    SET value = '"prembly"'::jsonb,
        updated_at = now();

-- 5. Ensure Prembly is priority-1 and Dojah is priority-2
UPDATE kyc_providers SET priority = 1 WHERE provider_name = 'prembly';
UPDATE kyc_providers SET priority = 2 WHERE provider_name = 'dojah';

-- 6. Remove stale label on SETTING_DEFS description — nothing to do in DB
--    (that's handled in frontend code)
