
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 1. pg_cron: call liquidation-monitor every 30 seconds ──────────────────
-- pg_cron minimum granularity is 1 minute; for 30-second intervals we schedule
-- TWO jobs: one at second-0 of each minute, one delayed 30 seconds via pg_sleep.
SELECT cron.unschedule('liquidation-monitor-s0')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'liquidation-monitor-s0');
SELECT cron.unschedule('liquidation-monitor-s30') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'liquidation-monitor-s30');

SELECT cron.schedule(
  'liquidation-monitor-s0',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/liquidation-monitor',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key')
    ),
    body    := concat('{"time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'liquidation-monitor-s30',
  '* * * * *',
  $$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/liquidation-monitor',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key')
    ),
    body    := concat('{"time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- ── 2. pg_cron: call order-matcher every 5 seconds (2 jobs @ 0s + 5s offsets) ─
SELECT cron.unschedule('order-matcher-s0')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'order-matcher-s0');
SELECT cron.unschedule('order-matcher-s15') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'order-matcher-s15');
SELECT cron.unschedule('order-matcher-s30') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'order-matcher-s30');
SELECT cron.unschedule('order-matcher-s45') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'order-matcher-s45');

SELECT cron.schedule(
  'order-matcher-s0',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/order-matcher',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key')
    ),
    body    := concat('{"time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'order-matcher-s15',
  '* * * * *',
  $$
  SELECT pg_sleep(15);
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/order-matcher',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key')
    ),
    body    := concat('{"time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'order-matcher-s30',
  '* * * * *',
  $$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/order-matcher',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key')
    ),
    body    := concat('{"time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'order-matcher-s45',
  '* * * * *',
  $$
  SELECT pg_sleep(45);
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/order-matcher',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key')
    ),
    body    := concat('{"time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- ── 3. pg_cron: Binance sync every minute ─────────────────────────────────
SELECT cron.unschedule('binance-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'binance-sync');

SELECT cron.schedule(
  'binance-sync',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/binance-sync',
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key')
    ),
    body    := concat('{"time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

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
