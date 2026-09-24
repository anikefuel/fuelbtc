-- ── kyc_reviews table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyc_reviews (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       uuid          NOT NULL REFERENCES public.kyc_attempts(id) ON DELETE CASCADE,
  admin_user_id    uuid          NOT NULL REFERENCES public.profiles(id),
  action           text          NOT NULL,
  old_status       text,
  new_status       text,
  reason           text,
  notes            text,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.kyc_reviews IS 'Admin review actions on KYC attempts (source of truth)';
COMMENT ON COLUMN public.kyc_reviews.admin_user_id IS 'Supabase UUID of the admin — never ExchangeX text uid';

-- Indexes for kyc_reviews
CREATE INDEX IF NOT EXISTS idx_kyc_reviews_attempt   ON public.kyc_reviews (attempt_id);
CREATE INDEX IF NOT EXISTS idx_kyc_reviews_admin     ON public.kyc_reviews (admin_user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_reviews_created   ON public.kyc_reviews (created_at DESC);

-- ── Extra indexes on kyc_attempts ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_provider       ON public.kyc_attempts (provider);
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_created        ON public.kyc_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_provider_ref   ON public.kyc_attempts (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- ── RLS for kyc_reviews ─────────────────────────────────────────────────────
ALTER TABLE public.kyc_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY kyc_reviews_admin_all ON public.kyc_reviews
  FOR ALL
  USING  (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY kyc_reviews_service_all ON public.kyc_reviews
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── raw_provider_status on kyc_attempts (needed for admin detail) ────────────
ALTER TABLE public.kyc_attempts
  ADD COLUMN IF NOT EXISTS raw_provider_status text,
  ADD COLUMN IF NOT EXISTS submitted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS doc_type            text,
  ADD COLUMN IF NOT EXISTS country_code        text,
  ADD COLUMN IF NOT EXISTS failure_reason      text,
  ADD COLUMN IF NOT EXISTS result_doc_verify   text,
  ADD COLUMN IF NOT EXISTS result_face_match   text,
  ADD COLUMN IF NOT EXISTS result_liveness     text,
  ADD COLUMN IF NOT EXISTS result_aml          text,
  ADD COLUMN IF NOT EXISTS result_pep          text,
  ADD COLUMN IF NOT EXISTS result_sanctions    text,
  ADD COLUMN IF NOT EXISTS result_fraud        text,
  ADD COLUMN IF NOT EXISTS confidence_score    numeric,
  ADD COLUMN IF NOT EXISTS fraud_risk_score    numeric,
  ADD COLUMN IF NOT EXISTS manual_review_reasons jsonb,
  ADD COLUMN IF NOT EXISTS last_webhook_at     timestamptz,
  ADD COLUMN IF NOT EXISTS full_name           text,
  ADD COLUMN IF NOT EXISTS date_of_birth       text;