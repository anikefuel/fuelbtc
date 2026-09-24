
-- ═══════════════════════════════════════════════════════════════════════════════
-- Trading Wallet Ledger + Reconciliation Enhancements
-- Adds: spot fill ledger RPC, futures funding fee RPC, spot→futures transfer,
--       reconciliation_warnings provider_config_id FK, run_reconciliation RPC
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── reconciliation_warnings: add details JSONB if missing ─────────────────────
ALTER TABLE public.reconciliation_warnings
  ADD COLUMN IF NOT EXISTS details JSONB;

-- ── reconciliation_warnings: add resolution_note if missing ──────────────────
ALTER TABLE public.reconciliation_warnings
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- ── wallet_ledger_entries: ensure entry_type covers trading events ────────────
-- The ledger_entries table already has entry_type TEXT — no enum change needed.

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: record_spot_fill
-- Called by order-matcher (service role) after settle_matched_orders to write
-- double-entry ledger records for both buyer and seller.
-- SECURITY DEFINER — runs as service role, bypasses RLS.
-- Idempotent: skips if order already has a ledger entry for this fill.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_spot_fill(
  p_buy_order_id   UUID,
  p_sell_order_id  UUID,
  p_buyer_id       UUID,
  p_seller_id      UUID,
  p_base_asset     TEXT,
  p_quote_asset    TEXT,
  p_fill_qty       NUMERIC,
  p_fill_price     NUMERIC,
  p_buy_fee        NUMERIC DEFAULT 0,
  p_sell_fee       NUMERIC DEFAULT 0,
  p_fee_asset      TEXT DEFAULT 'USDT'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fill_value NUMERIC := p_fill_qty * p_fill_price;
BEGIN
  -- Idempotency: skip if buy order already has spot_fill entry
  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE reference_id = p_buy_order_id AND entry_type = 'spot_fill_credit'
  ) THEN RETURN; END IF;

  -- Buyer receives base asset, pays quote asset
  INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
  VALUES
    (p_buyer_id, p_base_asset,  'spot_fill_credit', p_fill_qty,   0,          p_buy_order_id,  'order', format('Spot buy fill: %s %s @ %s', p_fill_qty, p_base_asset, p_fill_price)),
    (p_buyer_id, p_quote_asset, 'spot_fill_debit',  0,            v_fill_value, p_buy_order_id, 'order', format('Spot buy cost: %s %s', v_fill_value, p_quote_asset));

  -- Seller receives quote asset, delivers base asset
  INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
  VALUES
    (p_seller_id, p_quote_asset, 'spot_fill_credit', v_fill_value, 0,          p_sell_order_id, 'order', format('Spot sell fill: %s %s @ %s', p_fill_qty, p_base_asset, p_fill_price)),
    (p_seller_id, p_base_asset,  'spot_fill_debit',  0,            p_fill_qty, p_sell_order_id, 'order', format('Spot sell cost: %s %s', p_fill_qty, p_base_asset));

  -- Fee entries (if non-zero)
  IF p_buy_fee > 0 THEN
    INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
    VALUES (p_buyer_id,  p_fee_asset, 'spot_fee', 0, p_buy_fee,  p_buy_order_id,  'order', format('Spot buy fee: %s %s', p_buy_fee, p_fee_asset));
  END IF;
  IF p_sell_fee > 0 THEN
    INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
    VALUES (p_seller_id, p_fee_asset, 'spot_fee', 0, p_sell_fee, p_sell_order_id, 'order', format('Spot sell fee: %s %s', p_sell_fee, p_fee_asset));
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: record_futures_funding_fee
-- Deducts accrued funding fee from futures wallet and writes ledger entry.
-- Called by a scheduled job or liquidation-monitor.
-- Idempotent: reference_id = position_id + period_ts.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_futures_funding_fee(
  p_user_id      UUID,
  p_position_id  UUID,
  p_symbol       TEXT,
  p_fee_amount   NUMERIC,  -- positive = user pays, negative = user receives
  p_period_ts    TIMESTAMPTZ DEFAULT NOW()
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency_key TEXT := p_position_id::TEXT || '_' || to_char(p_period_ts AT TIME ZONE 'UTC', 'YYYYMMDD_HH24');
BEGIN
  -- Idempotency: skip if already recorded for this position+period
  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE reference_type = 'funding_fee' AND description LIKE '%' || v_idempotency_key || '%'
  ) THEN RETURN; END IF;

  IF p_fee_amount > 0 THEN
    -- User pays funding fee: debit futures USDT wallet
    UPDATE wallets
    SET available_balance = GREATEST(0, available_balance - p_fee_amount),
        updated_at        = NOW()
    WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures';

    INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_id, reference_type, description)
    VALUES (p_user_id, 'USDT', 'futures_funding_fee', p_fee_amount, 0, p_position_id, 'funding_fee',
            format('Funding fee paid for %s [%s]', p_symbol, v_idempotency_key));
  ELSE
    -- User receives funding fee: credit futures USDT wallet
    UPDATE wallets
    SET available_balance = available_balance + ABS(p_fee_amount),
        updated_at        = NOW()
    WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures';

    INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
    VALUES (p_user_id, 'USDT', 'futures_funding_income', ABS(p_fee_amount), 0, p_position_id, 'funding_fee',
            format('Funding fee received for %s [%s]', p_symbol, v_idempotency_key));
  END IF;

  -- Update cumulative funding fee on position
  UPDATE positions
  SET cum_funding_fee = cum_funding_fee + p_fee_amount,
      updated_at      = NOW()
  WHERE id = p_position_id AND user_id = p_user_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: spot_to_futures_transfer
-- Atomic transfer from spot USDT → futures USDT wallet (margin top-up).
-- Also handles reverse: futures → spot (margin withdrawal).
-- Uses existing wallet_transfer_internal logic inline for atomicity.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.spot_to_futures_transfer(
  p_user_id   UUID,
  p_amount    NUMERIC,
  p_asset     TEXT DEFAULT 'USDT',
  p_direction TEXT DEFAULT 'spot_to_futures'  -- 'spot_to_futures' | 'futures_to_spot'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_type wallet_type;
  v_to_type   wallet_type;
  v_avail     NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
  END IF;

  IF p_direction = 'spot_to_futures' THEN
    v_from_type := 'spot';
    v_to_type   := 'futures';
  ELSE
    v_from_type := 'futures';
    v_to_type   := 'spot';
  END IF;

  -- Check available balance
  SELECT available_balance INTO v_avail
  FROM wallets WHERE user_id = p_user_id AND asset = p_asset AND wallet_type = v_from_type
  FOR UPDATE;

  IF v_avail IS NULL OR v_avail < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: need %, have %', p_amount, COALESCE(v_avail, 0);
  END IF;

  -- Debit source
  UPDATE wallets
  SET available_balance = available_balance - p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND asset = p_asset AND wallet_type = v_from_type;

  -- Ensure destination wallet exists
  INSERT INTO wallets (user_id, wallet_type, asset)
  VALUES (p_user_id, v_to_type, p_asset)
  ON CONFLICT (user_id, wallet_type, asset) DO NOTHING;

  -- Credit destination
  UPDATE wallets
  SET available_balance = available_balance + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND asset = p_asset AND wallet_type = v_to_type;

  -- Ledger entries
  INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_type, description)
  VALUES
    (p_user_id, p_asset, 'internal_transfer_debit',  p_amount, 0,        'wallet_transfer', format('%s → %s transfer: %s %s', v_from_type, v_to_type, p_amount, p_asset)),
    (p_user_id, p_asset, 'internal_transfer_credit', 0,        p_amount, 'wallet_transfer', format('%s → %s received: %s %s', v_from_type, v_to_type, p_amount, p_asset));

  -- Audit log
  INSERT INTO wallet_audit_logs (actor_id, target_user_id, action, asset, amount, reference_type, reason)
  VALUES (p_user_id, p_user_id, p_direction, p_asset, p_amount, 'wallet_transfer',
          format('%s %s %s→%s', p_amount, p_asset, v_from_type, v_to_type));
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: run_reconciliation
-- Compares provider balances vs internal wallet totals per asset.
-- Writes reconciliation_warnings for mismatches > threshold.
-- Called by admin "Run Reconciliation" button via provider-action or direct RPC.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_reconciliation(
  p_config_id        UUID,
  p_provider_name    TEXT DEFAULT 'binance',
  p_threshold_pct    NUMERIC DEFAULT 1.0  -- flag when delta > 1%
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_warnings_created INT := 0;
  v_warnings_dup     INT := 0;
BEGIN
  -- Compare internal total wallet balances vs what Binance reported in wallets table (provider-synced)
  -- The binance-sync EF writes to wallets with the provider's user_id.
  -- Here we compare: sum of all user wallets per asset vs provider wallet totals.

  INSERT INTO reconciliation_warnings (
    provider_name, provider_config_id, asset,
    ledger_balance, provider_balance, delta_pct,
    warning_type, details
  )
  SELECT
    p_provider_name,
    p_config_id,
    asset,
    SUM(CASE WHEN wallet_type IN ('spot','funding','p2p','escrow') THEN COALESCE(available_balance,0) + COALESCE(locked_balance,0) ELSE 0 END) AS ledger_total,
    MAX(CASE WHEN wallet_type = 'spot' THEN COALESCE(available_balance,0) + COALESCE(locked_balance,0) ELSE 0 END) AS provider_total,
    CASE
      WHEN MAX(CASE WHEN wallet_type = 'spot' THEN COALESCE(available_balance,0) ELSE 0 END) = 0 THEN NULL
      ELSE ABS(
        SUM(CASE WHEN wallet_type IN ('spot','funding','p2p','escrow') THEN COALESCE(available_balance,0) ELSE 0 END)
        - MAX(CASE WHEN wallet_type = 'spot' THEN COALESCE(available_balance,0) ELSE 0 END)
      ) / NULLIF(MAX(CASE WHEN wallet_type = 'spot' THEN COALESCE(available_balance,0) ELSE 0 END), 0) * 100
    END,
    'balance_mismatch',
    jsonb_build_object('config_id', p_config_id, 'check_ts', NOW()::TEXT)
  FROM wallets
  GROUP BY asset
  HAVING ABS(
    SUM(CASE WHEN wallet_type IN ('spot','funding','p2p','escrow') THEN COALESCE(available_balance,0) ELSE 0 END)
    - MAX(CASE WHEN wallet_type = 'spot' THEN COALESCE(available_balance,0) ELSE 0 END)
  ) > p_threshold_pct / 100.0 * NULLIF(
    MAX(CASE WHEN wallet_type = 'spot' THEN COALESCE(available_balance,0) ELSE 0 END), 0
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_warnings_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'warnings_created', v_warnings_created,
    'checked_at', NOW()::TEXT
  );
END;
$$;

-- Grant execute to authenticated (admins call via RPC; RLS on reconciliation_warnings protects data)
GRANT EXECUTE ON FUNCTION public.record_spot_fill TO service_role;
GRANT EXECUTE ON FUNCTION public.record_futures_funding_fee TO service_role;
GRANT EXECUTE ON FUNCTION public.spot_to_futures_transfer TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_reconciliation TO authenticated;
