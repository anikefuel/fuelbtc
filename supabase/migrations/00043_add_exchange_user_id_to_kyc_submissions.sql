-- Add exchange_user_id (TEXT) column to kyc_submissions so the EXX display ID
-- can be stored as a reference WITHOUT being inserted into any UUID column.
-- user_id (uuid) remains the only FK to profiles — always populated from auth.uid().

ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS exchange_user_id text;  -- e.g. "EXX5bdbac7e" — display only

COMMENT ON COLUMN public.kyc_submissions.exchange_user_id
  IS 'ExchangeX display UID (EXX…) for human reference only. Never used as a UUID FK.';

-- Also ensure kyc_audit_log has the same safety column for reference
ALTER TABLE public.kyc_audit_log
  ADD COLUMN IF NOT EXISTS exchange_user_id text;

COMMENT ON COLUMN public.kyc_audit_log.exchange_user_id
  IS 'ExchangeX display UID (EXX…) for human reference only. Never used as a UUID FK.';