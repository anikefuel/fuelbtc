
-- ─────────────────────────────────────────────────────────────────────────────
-- KYC Provider System v2 — Dojah as Default Priority-1 Provider
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extend kyc_status enum with all required internal statuses
DO $$
BEGIN
  -- These may already exist from earlier migrations; use IF NOT EXISTS
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'in_progress';       EXCEPTION WHEN duplicate_object THEN null; END;
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'submitted';          EXCEPTION WHEN duplicate_object THEN null; END;
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'pending_review';     EXCEPTION WHEN duplicate_object THEN null; END;
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'abandoned';          EXCEPTION WHEN duplicate_object THEN null; END;
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'resubmission_required'; EXCEPTION WHEN duplicate_object THEN null; END;
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'provider_unavailable'; EXCEPTION WHEN duplicate_object THEN null; END;
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'manual_review';      EXCEPTION WHEN duplicate_object THEN null; END;
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'verified';           EXCEPTION WHEN duplicate_object THEN null; END;
  BEGIN ALTER TYPE public.kyc_status ADD VALUE IF NOT EXISTS 'failed';             EXCEPTION WHEN duplicate_object THEN null; END;
END $$;

-- 2. KYC Providers configuration table
CREATE TABLE IF NOT EXISTS public.kyc_providers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name        text NOT NULL UNIQUE,           -- 'dojah' | 'sumsub' | 'manual'
  display_name         text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  priority             integer NOT NULL DEFAULT 10,    -- lower = higher priority; 1 = default
  supported_countries  text[] NOT NULL DEFAULT '{}',  -- empty = all countries
  supported_doc_types  text[] NOT NULL DEFAULT ARRAY['passport','national_id','drivers_licence','residence_permit'],
  health_status        text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy','degraded','unhealthy','unknown')),
  failure_count        integer NOT NULL DEFAULT 0,
  last_success_at      timestamptz,
  last_error           text,
  last_error_at        timestamptz,
  auto_fallback        boolean NOT NULL DEFAULT true,
  manual_selection     boolean NOT NULL DEFAULT false, -- allow user to manually select
  config               jsonb NOT NULL DEFAULT '{}',   -- provider-specific config (no secrets)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kyc_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_providers" ON public.kyc_providers FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "auth_read_providers" ON public.kyc_providers FOR SELECT TO authenticated
  USING (true);

-- 3. KYC Attempts table — dedicated per-attempt tracking
CREATE TABLE IF NOT EXISTS public.kyc_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submission_id        uuid REFERENCES public.kyc_submissions(id) ON DELETE SET NULL,
  provider             text NOT NULL,                 -- 'dojah' | 'sumsub' | 'manual'
  provider_priority    integer NOT NULL DEFAULT 1,
  reference_id         text NOT NULL UNIQUE,          -- EXX-KYC-{UUID}
  widget_id            text,                          -- Dojah widget ID used
  country_code         text,
  doc_type             text DEFAULT 'passport',
  status               text NOT NULL DEFAULT 'not_started' CHECK (
    status IN ('not_started','in_progress','submitted','pending_review',
               'verified','failed','abandoned','resubmission_required',
               'provider_unavailable','manual_review')
  ),
  raw_provider_status  text,                          -- raw status from provider
  provider_ref_id      text,                          -- provider's own ID for this attempt
  fallback_provider    text,                          -- provider routed to on fallback
  failure_reason       text,
  started_at           timestamptz NOT NULL DEFAULT now(),
  submitted_at         timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kyc_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_attempts" ON public.kyc_attempts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "users_insert_attempts" ON public.kyc_attempts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins_attempts" ON public.kyc_attempts FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin');

-- Service role bypass for Edge Functions
CREATE POLICY "service_role_attempts" ON public.kyc_attempts FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- 4. KYC Provider Events — raw webhook/polling payloads
CREATE TABLE IF NOT EXISTS public.kyc_provider_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id     uuid REFERENCES public.kyc_attempts(id) ON DELETE SET NULL,
  submission_id  uuid REFERENCES public.kyc_submissions(id) ON DELETE SET NULL,
  provider       text NOT NULL,
  event_type     text NOT NULL,                       -- 'webhook' | 'poll' | 'manual_sync'
  reference_id   text,
  raw_payload    jsonb NOT NULL DEFAULT '{}',
  processed      boolean NOT NULL DEFAULT false,
  is_duplicate   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kyc_provider_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_events" ON public.kyc_provider_events FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin');
CREATE POLICY "service_role_events" ON public.kyc_provider_events FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_user        ON public.kyc_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_reference   ON public.kyc_attempts(reference_id);
CREATE INDEX IF NOT EXISTS idx_kyc_attempts_status      ON public.kyc_attempts(status);
CREATE INDEX IF NOT EXISTS idx_kyc_provider_events_ref  ON public.kyc_provider_events(reference_id);
CREATE INDEX IF NOT EXISTS idx_kyc_providers_priority   ON public.kyc_providers(priority, enabled);

-- 6. Seed Dojah as priority-1 default provider
INSERT INTO public.kyc_providers (provider_name, display_name, enabled, priority, supported_countries, config)
VALUES (
  'dojah',
  'Dojah EasyOnboard',
  true,
  1,
  '{}',   -- empty = supports ALL countries (Dojah is global default)
  jsonb_build_object(
    'widget_id',        '6a5b12349ff90fe054784334',
    'base_widget_url',  'https://identity.dojah.io',
    'hosted_url',       'https://identity.dojah.io?widget_id=6a5b12349ff90fe054784334',
    'integration_mode', 'hosted'   -- 'hosted' | 'sdk'
  )
)
ON CONFLICT (provider_name) DO UPDATE
  SET priority    = 1,
      enabled     = true,
      config      = jsonb_build_object(
        'widget_id',        '6a5b12349ff90fe054784334',
        'base_widget_url',  'https://identity.dojah.io',
        'hosted_url',       'https://identity.dojah.io?widget_id=6a5b12349ff90fe054784334',
        'integration_mode', 'hosted'
      ),
      updated_at  = now();

-- 7. Seed Sumsub as priority-2 fallback
INSERT INTO public.kyc_providers (provider_name, display_name, enabled, priority,
  supported_countries, auto_fallback, config)
VALUES (
  'sumsub',
  'Sumsub Identity Verification',
  true,
  2,
  ARRAY['US','GB','CA','AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE',
        'GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'],
  true,
  '{"integration_mode": "sdk"}'::jsonb
)
ON CONFLICT (provider_name) DO UPDATE
  SET priority    = 2,
      auto_fallback = true,
      updated_at  = now();

-- 8. Seed Manual Review as final fallback (priority 999)
INSERT INTO public.kyc_providers (provider_name, display_name, enabled, priority,
  supported_countries, auto_fallback, manual_selection, config)
VALUES (
  'manual',
  'Manual Compliance Review',
  true,
  999,
  '{}',
  true,
  false,
  '{"requires_documents": true}'::jsonb
)
ON CONFLICT (provider_name) DO NOTHING;

-- 9. Update kyc_settings with Dojah as default_provider
INSERT INTO public.kyc_settings (key, value) VALUES
  ('default_provider',        '"dojah"'),
  ('dojah_widget_id',         '"6a5b12349ff90fe054784334"'),
  ('dojah_base_url',          '"https://identity.dojah.io"'),
  ('dojah_hosted_url',        '"https://identity.dojah.io?widget_id=6a5b12349ff90fe054784334"'),
  ('max_dojah_retries',       '3'),
  ('fallback_enabled',        'true'),
  ('provider_health_timeout', '30')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();
