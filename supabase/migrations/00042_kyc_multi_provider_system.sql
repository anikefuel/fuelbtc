
-- ─────────────────────────────────────────────────────────────
-- KYC Multi-Provider System Migration
-- ─────────────────────────────────────────────────────────────

-- 1. Extend kyc_status enum with new values
ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'under_review';
ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'needs_manual_review';
ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'not_started';

-- 2. Extend kyc_submissions with provider + verification fields
ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS provider            text,          -- 'sumsub' | 'dojah'
  ADD COLUMN IF NOT EXISTS provider_ref_id     text,          -- provider's applicant/session ID
  ADD COLUMN IF NOT EXISTS country_code        text,
  ADD COLUMN IF NOT EXISTS doc_type            text,          -- passport | national_id | drivers_licence | residence_permit
  ADD COLUMN IF NOT EXISTS full_name           text,
  ADD COLUMN IF NOT EXISTS date_of_birth       text,
  ADD COLUMN IF NOT EXISTS doc_number_masked   text,          -- last-4 only
  ADD COLUMN IF NOT EXISTS address_line        text,
  -- Per-check results (provider-populated via webhook)
  ADD COLUMN IF NOT EXISTS result_doc_verify   text,          -- passed | failed | inconclusive
  ADD COLUMN IF NOT EXISTS result_face_match   text,
  ADD COLUMN IF NOT EXISTS result_liveness     text,
  ADD COLUMN IF NOT EXISTS result_address      text,
  ADD COLUMN IF NOT EXISTS result_aml          text,
  ADD COLUMN IF NOT EXISTS result_pep          text,
  ADD COLUMN IF NOT EXISTS result_sanctions    text,
  ADD COLUMN IF NOT EXISTS result_fraud        text,
  ADD COLUMN IF NOT EXISTS result_duplicate    text,
  ADD COLUMN IF NOT EXISTS confidence_score    numeric(5,2),  -- 0–100
  ADD COLUMN IF NOT EXISTS fraud_risk_score    numeric(5,2),
  ADD COLUMN IF NOT EXISTS manual_review_reasons jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS expires_at          timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_by        uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS escalated_at        timestamptz,
  ADD COLUMN IF NOT EXISTS appeal_at           timestamptz,
  ADD COLUMN IF NOT EXISTS raw_provider_payload jsonb DEFAULT '{}';

-- 3. KYC document storage manifest (links doc paths in Storage)
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.kyc_submissions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  doc_type    text NOT NULL,   -- 'id_front' | 'id_back' | 'selfie' | 'address_proof' | 'other'
  storage_path text NOT NULL,  -- private bucket path, never public URL
  mime_type   text NOT NULL DEFAULT 'image/jpeg',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_docs" ON public.kyc_documents FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users_insert_docs" ON public.kyc_documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins_docs" ON public.kyc_documents FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');

-- 4. KYC audit log (immutable)
CREATE TABLE IF NOT EXISTS public.kyc_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid REFERENCES public.kyc_submissions(id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES public.profiles(id),  -- admin who acted, null = system
  action        text NOT NULL,   -- 'submitted' | 'approved' | 'rejected' | 'escalated' | 'note_added' | 'webhook_received' | 'tier_upgraded' | ...
  old_status    text,
  new_status    text,
  reason        text,
  notes         text,
  metadata      jsonb DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kyc_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_audit" ON public.kyc_audit_log FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "users_own_audit" ON public.kyc_audit_log FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 5. KYC retry / failover queue
CREATE TABLE IF NOT EXISTS public.kyc_retry_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid NOT NULL REFERENCES public.kyc_submissions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  attempt_count   integer NOT NULL DEFAULT 0,
  last_error      text,
  next_retry_at   timestamptz NOT NULL DEFAULT now(),
  resolved        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kyc_retry_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_retry" ON public.kyc_retry_queue FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');

-- 6. KYC settings (admin-configurable, runtime)
CREATE TABLE IF NOT EXISTS public.kyc_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);
ALTER TABLE public.kyc_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_settings" ON public.kyc_settings FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "anon_read_settings" ON public.kyc_settings FOR SELECT TO anon USING (true);
CREATE POLICY "auth_read_settings" ON public.kyc_settings FOR SELECT TO authenticated USING (true);

-- 7. Seed default settings
INSERT INTO public.kyc_settings (key, value) VALUES
  ('sumsub_countries', '["US","GB","CA","AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]'),
  ('manual_review_confidence_threshold', '75'),
  ('fraud_risk_threshold', '60'),
  ('face_match_threshold', '80'),
  ('kyc_expiry_months', '12'),
  ('supported_doc_types', '["passport","national_id","drivers_licence","residence_permit"]'),
  ('tier_limits', '{
    "tier0": {"daily_deposit": 0, "daily_withdrawal": 0, "daily_trading": 0, "daily_p2p": 0},
    "tier1": {"daily_deposit": 1000, "daily_withdrawal": 0, "daily_trading": 5000, "daily_p2p": 500},
    "tier2": {"daily_deposit": 50000, "daily_withdrawal": 10000, "daily_trading": 100000, "daily_p2p": 20000},
    "tier3": {"daily_deposit": 500000, "daily_withdrawal": 100000, "daily_trading": 1000000, "daily_p2p": 200000}
  }')
ON CONFLICT (key) DO NOTHING;

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_kyc_submissions_provider_ref ON public.kyc_submissions(provider_ref_id) WHERE provider_ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_submissions_status ON public.kyc_submissions(status);
CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user ON public.kyc_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_submission ON public.kyc_audit_log(submission_id);
CREATE INDEX IF NOT EXISTS idx_kyc_retry_next ON public.kyc_retry_queue(next_retry_at) WHERE resolved = false;

-- 9. Storage bucket for private KYC documents (created via SQL helper)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-documents',
  'kyc-documents',
  false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can upload own docs; admins can read all
CREATE POLICY "kyc_user_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kyc-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "kyc_user_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kyc-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "kyc_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'kyc-documents' AND get_user_role(auth.uid()) = 'admin');
