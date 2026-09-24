-- Add safe text reference columns to kyc_attempts
-- These hold ExchangeX display IDs and provider text refs — never UUID FK values
ALTER TABLE public.kyc_attempts
  ADD COLUMN IF NOT EXISTS customer_reference  text,
  ADD COLUMN IF NOT EXISTS provider_reference  text,
  ADD COLUMN IF NOT EXISTS exchange_user_id    text;

-- Unique index: one active attempt per provider_reference (prevents duplicate webhook processing)
CREATE UNIQUE INDEX IF NOT EXISTS kyc_attempts_provider_reference_uniq
  ON public.kyc_attempts (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- Populate customer_reference from profiles.uid for any existing rows
UPDATE public.kyc_attempts a
SET customer_reference = p.uid
FROM public.profiles p
WHERE p.id = a.user_id
  AND a.customer_reference IS NULL;

-- Populate exchange_user_id from profiles.uid for any existing rows
UPDATE public.kyc_attempts a
SET exchange_user_id = p.uid
FROM public.profiles p
WHERE p.id = a.user_id
  AND a.exchange_user_id IS NULL;

COMMENT ON COLUMN public.kyc_attempts.customer_reference IS
  'ExchangeX display ID (e.g. EXX5bdbac7e) — text only, never used as UUID FK';
COMMENT ON COLUMN public.kyc_attempts.provider_reference IS
  'Provider-specific text reference (e.g. EXX-KYC-{UUID}) — text only, never used as UUID FK';
COMMENT ON COLUMN public.kyc_attempts.exchange_user_id IS
  'ExchangeX UID from profiles.uid — text only, for display/audit use';