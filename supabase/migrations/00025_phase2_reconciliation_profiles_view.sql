
-- ─── user_profiles_view: centralized profile/user lookup ─────────────────────
CREATE OR REPLACE VIEW public.user_profiles_view AS
SELECT
  p.id,
  p.uid,
  p.email,
  p.username,
  p.role,
  p.kyc_status,
  p.kyc_tier,
  p.is_frozen          AS account_frozen,
  p.two_fa_enabled,
  p.vip_level,
  p.created_at,
  p.updated_at
FROM public.profiles p;

COMMENT ON VIEW public.user_profiles_view IS
  'Central profile lookup — join this instead of profiles directly.';

-- ─── reconciliation_warnings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliation_warnings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name      TEXT NOT NULL,
  provider_config_id UUID REFERENCES public.exchange_provider_configs(id) ON DELETE SET NULL,
  asset              TEXT NOT NULL,
  ledger_balance     NUMERIC(36,18) NOT NULL DEFAULT 0,
  provider_balance   NUMERIC(36,18) NOT NULL DEFAULT 0,
  delta              NUMERIC(36,18) GENERATED ALWAYS AS (provider_balance - ledger_balance) STORED,
  delta_pct          NUMERIC(10,4),
  warning_type       TEXT NOT NULL DEFAULT 'balance_mismatch',
  details            JSONB,
  resolved           BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_note    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recon_unresolved  ON public.reconciliation_warnings(created_at DESC) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_recon_provider    ON public.reconciliation_warnings(provider_name, asset);

-- ─── provider_sync_results ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_sync_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id        UUID NOT NULL REFERENCES public.exchange_provider_configs(id) ON DELETE CASCADE,
  triggered_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  trigger_type     TEXT NOT NULL DEFAULT 'scheduled',
  success          BOOLEAN NOT NULL DEFAULT FALSE,
  balances_synced  INT NOT NULL DEFAULT 0,
  orders_synced    INT NOT NULL DEFAULT 0,
  positions_synced INT NOT NULL DEFAULT 0,
  warnings_created INT NOT NULL DEFAULT 0,
  error_message    TEXT,
  duration_ms      INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_psr_config ON public.provider_sync_results(config_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.reconciliation_warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_sync_results   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_recon_warnings" ON public.reconciliation_warnings
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "admins_sync_results"   ON public.provider_sync_results
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
