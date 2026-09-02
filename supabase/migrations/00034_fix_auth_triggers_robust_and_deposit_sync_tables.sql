-- ═══════════════════════════════════════════════════════════════════════════
-- Fix 1: Make auth triggers exception-safe (no trigger can ever abort signup)
-- Fix 2: Add unmatched_deposits table for admin review workflow
-- Fix 3: Add deposit/withdrawal sync state tables
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Robust handle_new_user: wraps body in EXCEPTION so it can never kill auth ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_referral TEXT;
BEGIN
  v_referral := (NEW.raw_user_meta_data ->> 'referral_code');
  IF v_referral IS NOT NULL THEN
    v_referral := upper(trim(v_referral));
  END IF;

  INSERT INTO public.profiles (id, email, referral_code, referred_by)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    'EXX' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_referral
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[handle_new_user] profile creation failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ─── Robust trg_provision_user_wallets: also exception-safe ──────────────────
CREATE OR REPLACE FUNCTION public.trg_provision_user_wallets()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_user_wallets(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_provision_user_wallets] wallet provisioning failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ─── unmatched_deposits: Binance deposits that couldn't be auto-attributed ────
CREATE TABLE IF NOT EXISTS unmatched_deposits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name     TEXT NOT NULL DEFAULT 'binance',
  provider_tx_id    TEXT NOT NULL,
  asset             TEXT NOT NULL,
  network           TEXT,
  amount            NUMERIC(28, 10) NOT NULL,
  fee               NUMERIC(28, 10) NOT NULL DEFAULT 0,
  to_address        TEXT,
  from_address      TEXT,
  tx_hash           TEXT,
  insert_time       BIGINT,
  raw_data          JSONB,
  status            TEXT NOT NULL DEFAULT 'pending',
  attributed_to     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  attributed_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  attributed_at     TIMESTAMPTZ,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_name, provider_tx_id)
);

ALTER TABLE unmatched_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_unmatched_deposits" ON unmatched_deposits
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ─── deposit_sync_state ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposit_sync_state (
  provider_name   TEXT PRIMARY KEY,
  last_sync_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() - INTERVAL '7 days'),
  last_start_time BIGINT DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO deposit_sync_state (provider_name) VALUES ('binance')
ON CONFLICT (provider_name) DO NOTHING;

-- ─── withdrawal_sync_state ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawal_sync_state (
  provider_name   TEXT PRIMARY KEY,
  last_sync_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() - INTERVAL '7 days'),
  last_start_time BIGINT DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO withdrawal_sync_state (provider_name) VALUES ('binance')
ON CONFLICT (provider_name) DO NOTHING;

-- ─── RPC: attribute_unmatched_deposit (admin manual attribution) ──────────────
CREATE OR REPLACE FUNCTION public.attribute_unmatched_deposit(
  p_unmatched_id  UUID,
  p_user_id       UUID,
  p_admin_id      UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    unmatched_deposits%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_row FROM unmatched_deposits WHERE id = p_unmatched_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_processed', 'status', v_row.status);
  END IF;

  SELECT public.process_deposit_credit(
    p_user_id, v_row.asset, v_row.network, v_row.amount,
    v_row.provider_tx_id, v_row.provider_name, NULL,
    v_row.to_address, v_row.from_address, v_row.tx_hash,
    v_row.fee, 'funding', v_row.raw_data
  ) INTO v_result;

  UPDATE unmatched_deposits SET
    status        = 'attributed',
    attributed_to = p_user_id,
    attributed_by = p_admin_id,
    attributed_at = NOW()
  WHERE id = p_unmatched_id;

  RETURN jsonb_build_object('ok', true, 'credit_result', v_result);
END;
$$;

-- ─── RPC: ignore_unmatched_deposit ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ignore_unmatched_deposit(
  p_unmatched_id UUID,
  p_admin_id     UUID,
  p_note         TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE unmatched_deposits SET
    status        = 'ignored',
    attributed_by = p_admin_id,
    attributed_at = NOW(),
    note          = p_note
  WHERE id = p_unmatched_id AND status = 'pending';
END;
$$;

-- ─── pg_cron: schedule deposit + withdrawal sync every 5 minutes ─────────────
SELECT cron.schedule(
  'binance-deposit-sync',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url  := (SELECT CONCAT(decrypted_secret, '/functions/v1/binance-deposit-sync')
             FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', CONCAT('Bearer ', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1))
    ),
    body := '{}'::jsonb
  ) AS request_id;$$
);

SELECT cron.schedule(
  'binance-withdrawal-sync',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url  := (SELECT CONCAT(decrypted_secret, '/functions/v1/binance-withdrawal-sync')
             FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', CONCAT('Bearer ', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1))
    ),
    body := '{}'::jsonb
  ) AS request_id;$$
);