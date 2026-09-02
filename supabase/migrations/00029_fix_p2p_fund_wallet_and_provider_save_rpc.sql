
-- ─── 1. Fix p2p_fund_wallet: use balance (not available_balance/total_balance) ─
-- Note: available_balance/total_balance now exist but are derived columns.
-- The UPDATE can reference them normally, but to avoid trigger-loop we update balance directly.
CREATE OR REPLACE FUNCTION public.p2p_fund_wallet(
  p_user_id  UUID,
  p_asset    TEXT,
  p_amount   NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_wallet_id UUID;
  v_bal_before NUMERIC;
  v_bal_after  NUMERIC;
BEGIN
  -- User can only fund their own wallet
  IF v_caller IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Not authorised: caller != p_user_id';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Ensure spot wallet exists (using correct column names)
  INSERT INTO wallets (user_id, asset, wallet_type, balance, locked_balance,
                       escrow_balance, pending_deposit, pending_withdraw)
  VALUES (p_user_id, p_asset, 'spot', 0, 0, 0, 0, 0)
  ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

  -- Get current balance before credit
  SELECT id, balance INTO v_wallet_id, v_bal_before
  FROM wallets
  WHERE user_id = p_user_id AND asset = p_asset AND wallet_type = 'spot';

  v_bal_after := v_bal_before + p_amount;

  -- Credit the wallet balance (trigger auto-updates available_balance + total_balance)
  UPDATE wallets
     SET balance    = balance + p_amount,
         updated_at = now()
   WHERE id = v_wallet_id;

  -- Ledger entry in wallet_ledger (now that the table exists)
  INSERT INTO wallet_ledger (
    wallet_id, user_id, transaction_type, asset,
    amount, balance_before, balance_after,
    reference_type, description
  ) VALUES (
    v_wallet_id, p_user_id, 'p2p_fund', p_asset,
    p_amount, v_bal_before, v_bal_after,
    'p2p_fund', 'P2P balance funding: ' || p_amount || ' ' || p_asset
  );

  -- Also record in wallet_audit_logs for admin audit trail
  INSERT INTO wallet_audit_logs (
    actor_id, target_user_id, action, asset, amount,
    reference_type, metadata
  ) VALUES (
    p_user_id, p_user_id, 'p2p_fund', p_asset, p_amount,
    'p2p_fund',
    jsonb_build_object('wallet_type', 'spot', 'balance_before', v_bal_before, 'balance_after', v_bal_after)
  );
END;
$$;

-- ─── 2. SECURITY DEFINER RPC: save_provider_config (server-side UUID validation) ─
-- This replaces direct PostgREST INSERT/UPDATE from client.
-- The caller's UUID is ALWAYS taken from auth.uid() server-side.
CREATE OR REPLACE FUNCTION public.save_provider_config(
  p_id           UUID    DEFAULT NULL,
  p_provider     TEXT    DEFAULT NULL,
  p_label        TEXT    DEFAULT NULL,
  p_api_key      TEXT    DEFAULT NULL,
  p_api_secret   TEXT    DEFAULT NULL,
  p_passphrase   TEXT    DEFAULT '',
  p_is_testnet   BOOLEAN DEFAULT FALSE,
  p_permissions  TEXT[]  DEFAULT '{}',
  p_notes        TEXT    DEFAULT ''
)
RETURNS TABLE (
  id UUID, provider_name TEXT, label TEXT, is_active BOOLEAN,
  is_testnet BOOLEAN, has_key BOOLEAN, permissions TEXT[],
  notes TEXT, health_status TEXT,
  last_sync_at TIMESTAMPTZ, last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ, avg_response_ms INT,
  error_count INT, sync_error TEXT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();          -- Always UUID from JWT
  v_record_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Require admin role
  SELECT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = v_user_id AND profiles.role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Validate required fields
  IF p_provider IS NULL OR trim(p_provider) = '' THEN
    RAISE EXCEPTION 'Provider name is required';
  END IF;

  IF p_id IS NOT NULL THEN
    -- UPDATE existing record
    UPDATE exchange_provider_configs
    SET
      provider_name = COALESCE(NULLIF(trim(p_provider), ''), provider_name),
      label         = COALESCE(NULLIF(trim(p_label),    ''), label),
      api_key       = CASE WHEN p_api_key    IS NOT NULL AND trim(p_api_key)    != '' THEN trim(p_api_key)    ELSE api_key    END,
      api_secret    = CASE WHEN p_api_secret IS NOT NULL AND trim(p_api_secret) != '' THEN trim(p_api_secret) ELSE api_secret END,
      passphrase    = CASE WHEN p_passphrase IS NOT NULL AND trim(p_passphrase) != '' THEN trim(p_passphrase) ELSE passphrase END,
      is_testnet    = p_is_testnet,
      permissions   = p_permissions,
      notes         = p_notes,
      user_id       = v_user_id,          -- Always use server-side UUID
      updated_at    = now()
    WHERE id = p_id
    RETURNING id INTO v_record_id;

    IF v_record_id IS NULL THEN
      RAISE EXCEPTION 'Provider config not found: %', p_id;
    END IF;
  ELSE
    -- INSERT new record
    INSERT INTO exchange_provider_configs (
      provider_name, label, api_key, api_secret, passphrase,
      is_testnet, permissions, notes, user_id, is_active,
      health_status, error_count, ws_state, rest_fallback
    ) VALUES (
      trim(p_provider),
      COALESCE(NULLIF(trim(p_label), ''), trim(p_provider)),
      COALESCE(p_api_key,    ''),
      COALESCE(p_api_secret, ''),
      COALESCE(p_passphrase, ''),
      p_is_testnet, p_permissions, p_notes,
      v_user_id,     -- Always use server-side UUID
      TRUE,
      'unknown', 0, 'disconnected', FALSE
    ) RETURNING id INTO v_record_id;
  END IF;

  -- Return safe view (NO api_key / api_secret in output)
  RETURN QUERY
    SELECT
      c.id, c.provider_name, c.label, c.is_active, c.is_testnet,
      (length(c.api_key) > 0) AS has_key,
      c.permissions, c.notes, c.health_status,
      c.last_sync_at, c.last_success_at, c.last_failure_at,
      c.avg_response_ms, c.error_count, c.sync_error,
      c.created_at, c.updated_at
    FROM exchange_provider_configs c
    WHERE c.id = v_record_id;
END;
$$;

-- ─── 3. SECURITY DEFINER RPC: list_provider_configs_safe ─────────────────────
-- Returns provider configs without exposing api_key/api_secret
CREATE OR REPLACE FUNCTION public.list_provider_configs_safe()
RETURNS TABLE (
  id UUID, provider_name TEXT, label TEXT, is_active BOOLEAN,
  is_testnet BOOLEAN, has_key BOOLEAN, permissions TEXT[],
  notes TEXT, health_status TEXT,
  last_sync_at TIMESTAMPTZ, last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ, avg_response_ms INT,
  error_count INT, sync_error TEXT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.provider_name, c.label, c.is_active, c.is_testnet,
    (length(c.api_key) > 0) AS has_key,
    c.permissions, c.notes, c.health_status,
    c.last_sync_at, c.last_success_at, c.last_failure_at,
    c.avg_response_ms, c.error_count, c.sync_error,
    c.created_at, c.updated_at
  FROM exchange_provider_configs c
  WHERE EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  )
  ORDER BY c.created_at DESC;
$$;
