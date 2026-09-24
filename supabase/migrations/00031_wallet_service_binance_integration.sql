
-- ═══════════════════════════════════════════════════════════════════════════
-- Wallet Service — Binance Integration
-- Adds idempotency, provider tracking, and atomic deposit credit RPC
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── deposits: add provider tracking columns ─────────────────────────────────
ALTER TABLE deposits
  ADD COLUMN IF NOT EXISTS provider_tx_id       TEXT,
  ADD COLUMN IF NOT EXISTS provider_name        TEXT DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS provider_config_id   UUID REFERENCES exchange_provider_configs(id),
  ADD COLUMN IF NOT EXISTS idempotency_key      TEXT,
  ADD COLUMN IF NOT EXISTS credited_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_provider_data    JSONB;

-- Unique index on provider_tx_id per provider to prevent duplicate credits
CREATE UNIQUE INDEX IF NOT EXISTS deposits_provider_tx_id_uq
  ON deposits (provider_name, provider_tx_id)
  WHERE provider_tx_id IS NOT NULL;

-- ─── withdrawals: add Binance tracking columns ────────────────────────────────
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS binance_withdraw_id  TEXT,
  ADD COLUMN IF NOT EXISTS binance_tx_hash      TEXT,
  ADD COLUMN IF NOT EXISTS provider_name        TEXT DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS provider_config_id   UUID REFERENCES exchange_provider_configs(id),
  ADD COLUMN IF NOT EXISTS submitted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_status      TEXT,
  ADD COLUMN IF NOT EXISTS raw_provider_data    JSONB;

-- ─── deposit_addresses: add provider tracking ─────────────────────────────────
ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS provider_name        TEXT DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS provider_config_id   UUID REFERENCES exchange_provider_configs(id),
  ADD COLUMN IF NOT EXISTS is_active            BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── wallet_provider_status: cache provider connectivity per config ───────────
CREATE TABLE IF NOT EXISTS wallet_provider_status (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id         UUID NOT NULL REFERENCES exchange_provider_configs(id),
  status            TEXT NOT NULL DEFAULT 'unknown',  -- connected|auth_failed|missing_permission|rate_limited|degraded|disabled|unknown
  deposit_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  withdraw_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  spot_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  futures_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  permissions       TEXT[] NOT NULL DEFAULT '{}',
  latency_ms        INTEGER,
  last_checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message     TEXT,
  UNIQUE (config_id)
);

ALTER TABLE wallet_provider_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_provider_status" ON wallet_provider_status
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ─── process_deposit_credit ─────────────────────────────────────────────────
-- Idempotent: skips if provider_tx_id already credited for this provider.
-- Credits internal ledger ONLY after provider confirmation.
-- SECURITY DEFINER: callable from Edge Functions only (service role bypasses RLS).
CREATE OR REPLACE FUNCTION public.process_deposit_credit(
  p_user_id           UUID,
  p_asset             TEXT,
  p_network           TEXT,
  p_amount            NUMERIC,
  p_provider_tx_id    TEXT,
  p_provider_name     TEXT DEFAULT 'binance',
  p_provider_config_id UUID DEFAULT NULL,
  p_to_address        TEXT DEFAULT NULL,
  p_from_address      TEXT DEFAULT NULL,
  p_tx_hash           TEXT DEFAULT NULL,
  p_fee               NUMERIC DEFAULT 0,
  p_wallet_type       TEXT DEFAULT 'funding',
  p_raw_data          JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deposit_id  UUID;
  v_wallet      wallets;
  v_is_dup      BOOLEAN;
  v_wtype       wallet_type := p_wallet_type::wallet_type;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'amount_invalid');
  END IF;
  IF p_provider_tx_id IS NULL OR trim(p_provider_tx_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_provider_tx_id');
  END IF;
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  END IF;

  -- Idempotency check: already processed?
  SELECT EXISTS (
    SELECT 1 FROM deposits d
    WHERE d.provider_name = p_provider_name
      AND d.provider_tx_id = p_provider_tx_id
      AND d.status = 'credited'
  ) INTO v_is_dup;

  IF v_is_dup THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_credited', 'duplicate', true);
  END IF;

  -- Upsert deposit record
  INSERT INTO deposits (
    user_id, asset, network, amount, fee,
    to_address, from_address, tx_hash,
    provider_tx_id, provider_name, provider_config_id,
    status, confirmations, required_confs,
    credited_at, raw_provider_data
  ) VALUES (
    p_user_id, p_asset, p_network, p_amount, COALESCE(p_fee, 0),
    p_to_address, p_from_address, p_tx_hash,
    p_provider_tx_id, p_provider_name, p_provider_config_id,
    'credited', 999, 1,
    NOW(), p_raw_data
  )
  ON CONFLICT (provider_name, provider_tx_id)
  DO UPDATE SET
    status = 'credited',
    credited_at = NOW(),
    raw_provider_data = COALESCE(p_raw_data, deposits.raw_provider_data)
  RETURNING id INTO v_deposit_id;

  -- Ensure user wallet exists
  INSERT INTO wallets (user_id, wallet_type, asset)
  VALUES (p_user_id, v_wtype, p_asset)
  ON CONFLICT (user_id, wallet_type, asset) DO NOTHING;

  -- Credit the wallet balance
  UPDATE wallets
  SET balance    = balance + p_amount,
      updated_at = NOW()
  WHERE user_id   = p_user_id
    AND wallet_type = v_wtype
    AND asset       = p_asset;

  -- Update legacy ledger_accounts
  INSERT INTO ledger_accounts (user_id, asset, available_balance)
  VALUES (p_user_id, p_asset, p_amount)
  ON CONFLICT (user_id, asset) DO UPDATE
  SET available_balance = ledger_accounts.available_balance + p_amount,
      updated_at        = NOW();

  -- Ledger entry for double-entry bookkeeping
  INSERT INTO ledger_entries (
    user_id, asset, entry_type, credit, debit,
    reference_id, reference_type, description
  ) VALUES (
    p_user_id, p_asset, 'deposit_credit', p_amount, 0,
    v_deposit_id, 'deposit',
    format('Deposit %s %s via %s', p_amount, p_asset, p_provider_name)
  );

  -- Audit log
  INSERT INTO wallet_audit_logs (
    actor_id, target_user_id, action, asset, amount,
    reference_id, reference_type, reason
  ) VALUES (
    p_user_id, p_user_id, 'deposit_credit', p_asset, p_amount,
    v_deposit_id, 'deposit',
    format('Credited via %s tx: %s', p_provider_name, p_provider_tx_id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'deposit_id', v_deposit_id,
    'amount_credited', p_amount,
    'asset', p_asset,
    'wallet_type', p_wallet_type
  );
END;
$$;

-- ─── submit_withdrawal_request ───────────────────────────────────────────────
-- Creates or updates a withdrawal record atomically, locking user funds.
-- Called by Edge Function after validating Binance submission.
CREATE OR REPLACE FUNCTION public.mark_withdrawal_submitted(
  p_withdrawal_id      UUID,
  p_binance_withdraw_id TEXT,
  p_provider_name      TEXT DEFAULT 'binance',
  p_provider_config_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE withdrawals
  SET status              = 'broadcasting',
      binance_withdraw_id = p_binance_withdraw_id,
      provider_name       = p_provider_name,
      provider_config_id  = p_provider_config_id,
      submitted_at        = NOW(),
      updated_at          = NOW()
  WHERE id = p_withdrawal_id
    AND status IN ('pending', 'approved', 'security_review');
END;
$$;

-- ─── mark_withdrawal_completed ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_withdrawal_completed(
  p_withdrawal_id      UUID,
  p_tx_hash            TEXT,
  p_provider_status    TEXT DEFAULT 'completed'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_asset   TEXT;
  v_amount  NUMERIC;
  v_locked  NUMERIC;
BEGIN
  SELECT user_id, asset, amount INTO v_user_id, v_asset, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id;

  IF v_user_id IS NULL THEN RETURN; END IF;

  UPDATE withdrawals
  SET status          = 'completed',
      tx_hash         = p_tx_hash,
      provider_status = p_provider_status,
      updated_at      = NOW()
  WHERE id = p_withdrawal_id
    AND status NOT IN ('completed', 'cancelled');

  -- Release the pending_withdraw lock (the debit was already applied in wallet_withdrawal_request)
  UPDATE wallets
  SET pending_withdraw = GREATEST(0, pending_withdraw - v_amount),
      updated_at       = NOW()
  WHERE user_id = v_user_id AND asset = v_asset;

  INSERT INTO ledger_entries (
    user_id, asset, entry_type, debit, credit,
    reference_id, reference_type, description
  ) VALUES (
    v_user_id, v_asset, 'withdrawal_debit', v_amount, 0,
    p_withdrawal_id, 'withdrawal',
    format('Withdrawal %s %s completed, tx: %s', v_amount, v_asset, p_tx_hash)
  );
END;
$$;

-- ─── mark_withdrawal_failed: refund locked funds ─────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_withdrawal_failed(
  p_withdrawal_id UUID,
  p_reason        TEXT DEFAULT 'Provider rejected'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_asset   TEXT;
  v_amount  NUMERIC;
BEGIN
  SELECT user_id, asset, amount INTO v_user_id, v_asset, v_amount
  FROM withdrawals WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN RETURN; END IF;

  UPDATE withdrawals
  SET status              = 'failed',
      rejection_reason    = p_reason,
      updated_at          = NOW()
  WHERE id = p_withdrawal_id
    AND status NOT IN ('completed', 'cancelled', 'failed');

  -- Refund: release pending_withdraw and restore balance
  UPDATE wallets
  SET balance          = balance + v_amount,
      pending_withdraw = GREATEST(0, pending_withdraw - v_amount),
      updated_at       = NOW()
  WHERE user_id = v_user_id AND asset = v_asset
    AND wallet_type = 'spot';

  -- Refund ledger entry
  INSERT INTO ledger_entries (
    user_id, asset, entry_type, credit, debit,
    reference_id, reference_type, description
  ) VALUES (
    v_user_id, v_asset, 'refund_credit', v_amount, 0,
    p_withdrawal_id, 'withdrawal_refund',
    format('Withdrawal failed refund: %s', p_reason)
  );

  INSERT INTO wallet_audit_logs (
    actor_id, target_user_id, action, asset, amount,
    reference_id, reference_type, reason
  ) VALUES (
    v_user_id, v_user_id, 'withdrawal_refund', v_asset, v_amount,
    p_withdrawal_id, 'withdrawal', p_reason
  );
END;
$$;

-- ─── update_provider_status: upsert wallet_provider_status ───────────────────
CREATE OR REPLACE FUNCTION public.upsert_wallet_provider_status(
  p_config_id       UUID,
  p_status          TEXT,
  p_deposit_enabled BOOLEAN DEFAULT FALSE,
  p_withdraw_enabled BOOLEAN DEFAULT FALSE,
  p_spot_enabled    BOOLEAN DEFAULT FALSE,
  p_futures_enabled BOOLEAN DEFAULT FALSE,
  p_permissions     TEXT[] DEFAULT '{}',
  p_latency_ms      INTEGER DEFAULT NULL,
  p_error_message   TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO wallet_provider_status (
    config_id, status,
    deposit_enabled, withdraw_enabled, spot_enabled, futures_enabled,
    permissions, latency_ms, last_checked_at, error_message
  ) VALUES (
    p_config_id, p_status,
    p_deposit_enabled, p_withdraw_enabled, p_spot_enabled, p_futures_enabled,
    p_permissions, p_latency_ms, NOW(), p_error_message
  )
  ON CONFLICT (config_id) DO UPDATE SET
    status           = p_status,
    deposit_enabled  = p_deposit_enabled,
    withdraw_enabled = p_withdraw_enabled,
    spot_enabled     = p_spot_enabled,
    futures_enabled  = p_futures_enabled,
    permissions      = p_permissions,
    latency_ms       = p_latency_ms,
    last_checked_at  = NOW(),
    error_message    = p_error_message;
$$;
