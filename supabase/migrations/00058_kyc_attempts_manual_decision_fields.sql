
-- ============================================================
-- Add manual-decision tracking columns to kyc_attempts
-- ============================================================
ALTER TABLE public.kyc_attempts
  ADD COLUMN IF NOT EXISTS reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_notes      TEXT,
  ADD COLUMN IF NOT EXISTS manual_override   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS decision_source   TEXT CHECK (decision_source IN ('provider','manual')) DEFAULT 'provider',
  ADD COLUMN IF NOT EXISTS final_decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_decision_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- Add KYC summary fields to profiles
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_provider    TEXT,
  ADD COLUMN IF NOT EXISTS kyc_country     TEXT;

-- ============================================================
-- Standardize: update existing 'approved' attempt statuses
-- that were set by the old Edge Function to 'verified'
-- (kyc_attempts.status uses text, not the enum)
-- ============================================================
UPDATE public.kyc_attempts
  SET status = 'verified', updated_at = NOW()
  WHERE status = 'approved';

-- Also fix profile kyc_status: 'approved' → 'verified' (enum has both)
UPDATE public.profiles
  SET kyc_status = 'verified'
  WHERE kyc_status = 'approved';

-- ============================================================
-- Index for fast manual-decision lookups
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_manual_override ON kyc_attempts (manual_override) WHERE manual_override = TRUE;
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_decision_source ON kyc_attempts (decision_source);
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_reviewed_by     ON kyc_attempts (reviewed_by) WHERE reviewed_by IS NOT NULL;

-- ============================================================
-- RLS: ensure admin can write reviewed_by / decision fields
-- (existing admin_all policies already cover this)
-- ============================================================
