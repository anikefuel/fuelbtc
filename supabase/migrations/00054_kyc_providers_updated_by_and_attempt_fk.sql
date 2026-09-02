
-- Ensure kyc_providers.updated_by column exists as UUID FK to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kyc_providers' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE public.kyc_providers ADD COLUMN updated_by UUID REFERENCES public.profiles(id);
    COMMENT ON COLUMN public.kyc_providers.updated_by IS 'Supabase UUID of last admin who modified — never ExchangeX text uid';
  END IF;
END $$;

-- Add missing index on kyc_attempts.user_id if not present
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_user_id ON public.kyc_attempts (user_id);

-- Confirm kyc_provider_events.attempt_id has index
CREATE INDEX IF NOT EXISTS idx_kyc_provider_events_attempt ON public.kyc_provider_events (attempt_id);

-- Ensure kyc_attempts has provider_reference column (used by new admin queries)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kyc_attempts' AND column_name = 'provider_reference'
  ) THEN
    ALTER TABLE public.kyc_attempts ADD COLUMN provider_reference TEXT;
    COMMENT ON COLUMN public.kyc_attempts.provider_reference IS 'Raw Dojah reference ID returned by the provider';
    -- Back-fill from reference_id
    UPDATE public.kyc_attempts SET provider_reference = reference_id WHERE provider_reference IS NULL;
  END IF;
END $$;

-- Add review_reason column to kyc_attempts if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kyc_attempts' AND column_name = 'review_reason'
  ) THEN
    ALTER TABLE public.kyc_attempts ADD COLUMN review_reason TEXT;
  END IF;
END $$;

-- Add customer_reference and exchange_user_id columns for admin list display
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kyc_attempts' AND column_name = 'customer_reference'
  ) THEN
    ALTER TABLE public.kyc_attempts ADD COLUMN customer_reference TEXT;
    COMMENT ON COLUMN public.kyc_attempts.customer_reference IS 'ExchangeX display ID (EXX-...) — text, not UUID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kyc_attempts' AND column_name = 'exchange_user_id'
  ) THEN
    ALTER TABLE public.kyc_attempts ADD COLUMN exchange_user_id TEXT;
    COMMENT ON COLUMN public.kyc_attempts.exchange_user_id IS 'ExchangeX display user id — text, not UUID FK';
  END IF;
END $$;

-- Create index on provider_reference for webhook matching
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_provider_ref_v2 ON public.kyc_attempts (provider_reference)
  WHERE provider_reference IS NOT NULL;
