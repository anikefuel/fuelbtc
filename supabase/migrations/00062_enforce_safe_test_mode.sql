-- Enforce a fail-closed test environment after all baseline migrations.
-- This migration intentionally keeps live exchange automation, trading,
-- deposits, and withdrawals disabled until a later reviewed enablement change.

-- These cursor tables are internal service state and must never be exposed
-- directly through the client API.
ALTER TABLE IF EXISTS public.deposit_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.withdrawal_sync_state ENABLE ROW LEVEL SECURITY;

-- Baseline migrations created scheduled jobs before the environment was fully
-- configured. Remove every exchange automation job for the initial test phase.
DO $$
DECLARE
  v_job RECORD;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'liquidation-monitor-s0',
      'liquidation-monitor-s30',
      'order-matcher-s0',
      'order-matcher-s15',
      'order-matcher-s30',
      'order-matcher-s45',
      'binance-sync',
      'binance-deposit-sync',
      'binance-withdrawal-sync',
      'p2p-expire-trades',
      'futures-liquidation-monitor',
      'futures-funding-settle'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$$;

-- Database kill switches must agree with the read-only VPS gateway.
UPDATE public.trading_settings
SET value = CASE
  WHEN key IN (
    'spot_trading_enabled',
    'futures_trading_enabled',
    'api_trading_enabled'
  ) THEN 'false'::jsonb
  WHEN key IN (
    'maintenance_mode',
    'spot_maintenance',
    'futures_maintenance',
    'futures_paused'
  ) THEN 'true'::jsonb
  ELSE value
END
WHERE key IN (
  'spot_trading_enabled',
  'futures_trading_enabled',
  'api_trading_enabled',
  'maintenance_mode',
  'spot_maintenance',
  'futures_maintenance',
  'futures_paused'
);

-- Keep every provider and money-movement route closed by default.
UPDATE public.exchange_provider_configs
SET is_active = false;

UPDATE public.wallet_provider_status
SET
  deposit_enabled = false,
  withdraw_enabled = false,
  spot_enabled = false,
  futures_enabled = false;

UPDATE public.assets
SET
  deposit_enabled = false,
  withdrawal_enabled = false;

UPDATE public.asset_networks
SET
  deposit_enabled = false,
  withdraw_enabled = false;
