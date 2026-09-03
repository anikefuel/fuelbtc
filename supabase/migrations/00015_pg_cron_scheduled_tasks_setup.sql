
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Scheduled engine jobs — disabled for safe initial deployment ─────────────
-- Do not start order matching, liquidation monitoring, or Binance account sync
-- merely by creating a database. These jobs use service-role operations and
-- must only be enabled by a later reviewed migration after:
--   1. the required Edge Functions are deployed,
--   2. internal caller authentication is configured,
--   3. provider credentials are installed, and
--   4. trading is explicitly enabled for the environment.
--
-- pg_cron and pg_net remain installed so a dedicated enablement migration can
-- add the schedules when the test environment is ready.

-- ── 4. exchange_provider_configs table (if not yet created) ────────────────
CREATE TABLE IF NOT EXISTS exchange_provider_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  label         text,
  api_key       text,
  api_secret    text,
  passphrase    text,
  permissions   text[] DEFAULT '{}',
  notes         text,
  is_active     boolean DEFAULT true,
  is_testnet    boolean DEFAULT false,
  last_sync_at  timestamptz,
  sync_error    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE exchange_provider_configs ENABLE ROW LEVEL SECURITY;

-- Only service-role / admin can touch this table — no anon/user policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exchange_provider_configs' AND policyname = 'admin_all_provider_configs'
  ) THEN
    CREATE POLICY admin_all_provider_configs ON exchange_provider_configs
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ── 5. order_match_log table to track engine activity ──────────────────────
CREATE TABLE IF NOT EXISTS order_match_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_order_id  uuid NOT NULL,
  sell_order_id uuid NOT NULL,
  symbol        text NOT NULL,
  matched_qty   numeric NOT NULL,
  match_price   numeric NOT NULL,
  fee_buy       numeric DEFAULT 0,
  fee_sell      numeric DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE order_match_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_match_log" ON order_match_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
