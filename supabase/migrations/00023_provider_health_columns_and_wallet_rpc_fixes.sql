
-- ── 1. Add health-tracking columns to exchange_provider_configs ───────────────
ALTER TABLE exchange_provider_configs
  ADD COLUMN IF NOT EXISTS last_sync_at      timestamptz,
  ADD COLUMN IF NOT EXISTS sync_error        text,
  ADD COLUMN IF NOT EXISTS health_status     text    NOT NULL DEFAULT 'unknown'
                             CHECK (health_status IN ('unknown','active','degraded','rate_limited','failed','disabled')),
  ADD COLUMN IF NOT EXISTS last_success_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_at   timestamptz,
  ADD COLUMN IF NOT EXISTS error_count       int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_response_ms   int,
  ADD COLUMN IF NOT EXISTS rate_limited_until timestamptz,
  ADD COLUMN IF NOT EXISTS ws_state          text    NOT NULL DEFAULT 'disconnected'
                             CHECK (ws_state IN ('disconnected','connected','error')),
  ADD COLUMN IF NOT EXISTS rest_fallback     boolean NOT NULL DEFAULT false;

-- ── 2. ensure_user_wallets — add margin wallet type ───────────────────────────
CREATE OR REPLACE FUNCTION ensure_user_wallets(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_assets       text[] := ARRAY['USDT','BTC','ETH','BNB','SOL','XRP','TRX','LTC','DOGE','USDC'];
  v_wallet_types text[] := ARRAY['spot','funding','p2p','escrow','futures','earn','margin'];
  v_asset        text;
  v_wtype        text;
BEGIN
  -- Ensure profile exists (profiles.id = auth.users.id via trigger)
  -- Skip if profile not ready yet
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RETURN;
  END IF;

  FOREACH v_asset IN ARRAY v_assets LOOP
    FOREACH v_wtype IN ARRAY v_wallet_types LOOP
      INSERT INTO wallets (user_id, wallet_type, asset, balance, locked_balance,
                           escrow_balance, pending_deposit, pending_withdraw)
      VALUES (p_user_id, v_wtype::wallet_type, v_asset, 0, 0, 0, 0, 0)
      ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;
    END LOOP;

    -- Ensure ledger_accounts row
    INSERT INTO ledger_accounts (user_id, asset, available_balance, locked_balance, pending_balance)
    VALUES (p_user_id, v_asset, 0, 0, 0)
    ON CONFLICT (user_id, asset) DO NOTHING;
  END LOOP;
END;
$$;

-- ── 3. wallet_withdrawal_approve RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION wallet_withdrawal_approve(
  p_withdrawal_id uuid,
  p_reviewer_id   uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wd withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO v_wd FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_wd.status NOT IN ('pending','under_review') THEN
    RAISE EXCEPTION 'Withdrawal is not in a reviewable state: %', v_wd.status;
  END IF;

  UPDATE withdrawals
    SET status      = 'approved',
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        updated_at  = now()
  WHERE id = p_withdrawal_id;

  INSERT INTO wallet_audit_logs(actor_id, target_user_id, action, asset, amount, reference_id, reference_type)
  VALUES (p_reviewer_id, v_wd.user_id, 'withdrawal_approved', v_wd.asset, v_wd.amount, p_withdrawal_id, 'withdrawal');
END;
$$;

-- ── 4. wallet_withdrawal_reject RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION wallet_withdrawal_reject(
  p_withdrawal_id uuid,
  p_reviewer_id   uuid,
  p_reason        text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wd withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO v_wd FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_wd.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'Cannot reject a withdrawal in state: %', v_wd.status;
  END IF;

  -- Refund the locked balance back to available
  PERFORM wallet_unlock(v_wd.user_id, v_wd.asset, v_wd.amount, 'spot',
    p_withdrawal_id, 'withdrawal_rejected');

  -- Decrease pending_withdraw counter
  UPDATE wallets
    SET pending_withdraw = GREATEST(0, pending_withdraw - v_wd.amount),
        updated_at       = now()
  WHERE user_id = v_wd.user_id AND wallet_type = 'spot' AND asset = v_wd.asset;

  -- Create refund ledger entry
  INSERT INTO ledger_entries(user_id, asset, account_id, entry_type, debit, credit,
    balance_before, balance_after, reference_id, reference_type, description)
  SELECT v_wd.user_id, v_wd.asset, la.id,
    'withdrawal_refund', 0, v_wd.amount,
    la.available_balance - v_wd.amount, la.available_balance,
    p_withdrawal_id, 'withdrawal',
    'Withdrawal rejected — funds refunded: ' || COALESCE(p_reason,'')
  FROM ledger_accounts la
  WHERE la.user_id = v_wd.user_id AND la.asset = v_wd.asset;

  UPDATE withdrawals
    SET status           = 'rejected',
        rejection_reason = p_reason,
        reviewed_by      = p_reviewer_id,
        reviewed_at      = now(),
        updated_at       = now()
  WHERE id = p_withdrawal_id;

  INSERT INTO wallet_audit_logs(actor_id, target_user_id, action, asset, amount, reference_id, reference_type, reason)
  VALUES (p_reviewer_id, v_wd.user_id, 'withdrawal_rejected', v_wd.asset, v_wd.amount, p_withdrawal_id, 'withdrawal', p_reason);
END;
$$;

-- ── 5. wallet_withdrawal_complete RPC (called by blockchain listener) ─────────
CREATE OR REPLACE FUNCTION wallet_withdrawal_complete(
  p_withdrawal_id uuid,
  p_tx_hash       text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wd withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO v_wd FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_wd.status NOT IN ('approved','processing') THEN
    RAISE EXCEPTION 'Cannot complete withdrawal in state: %', v_wd.status;
  END IF;

  -- Debit the locked funds from ledger (final deduction)
  UPDATE ledger_accounts
    SET locked_balance = GREATEST(0, locked_balance - v_wd.amount),
        updated_at     = now()
  WHERE user_id = v_wd.user_id AND asset = v_wd.asset;

  -- Finalize pending_withdraw counter
  UPDATE wallets
    SET locked_balance  = GREATEST(0, locked_balance - v_wd.amount),
        pending_withdraw = GREATEST(0, pending_withdraw - v_wd.amount),
        updated_at       = now()
  WHERE user_id = v_wd.user_id AND wallet_type = 'spot' AND asset = v_wd.asset;

  -- Create ledger entry
  INSERT INTO ledger_entries(user_id, asset, account_id, entry_type, debit, credit,
    balance_before, balance_after, reference_id, reference_type, description)
  SELECT v_wd.user_id, v_wd.asset, la.id,
    'withdrawal_complete', v_wd.amount, 0,
    la.locked_balance + v_wd.amount, la.locked_balance,
    p_withdrawal_id, 'withdrawal', 'Withdrawal completed'
  FROM ledger_accounts la
  WHERE la.user_id = v_wd.user_id AND la.asset = v_wd.asset;

  UPDATE withdrawals
    SET status     = 'completed',
        tx_hash    = COALESCE(p_tx_hash, tx_hash),
        updated_at = now()
  WHERE id = p_withdrawal_id;

  INSERT INTO wallet_audit_logs(actor_id, target_user_id, action, asset, amount, reference_id, reference_type)
  VALUES (v_wd.user_id, v_wd.user_id, 'withdrawal_completed', v_wd.asset, v_wd.amount, p_withdrawal_id, 'withdrawal');
END;
$$;

-- ── 6. p2p_lock_escrow — also write to escrows table ─────────────────────────
CREATE OR REPLACE FUNCTION p2p_lock_escrow(
  p_trade_id     uuid,
  p_seller_id    uuid,
  p_asset        text,
  p_amount       numeric,
  p_payment_window int DEFAULT 30
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_buyer_id uuid;
  v_escrow_id uuid;
BEGIN
  -- Get buyer from trade
  SELECT buyer_id INTO v_buyer_id FROM p2p_trades WHERE id = p_trade_id;

  -- Lock in ledger_accounts
  UPDATE ledger_accounts
    SET available_balance = available_balance - p_amount,
        locked_balance    = locked_balance + p_amount,
        updated_at        = now()
    WHERE user_id = p_seller_id AND asset = p_asset AND available_balance >= p_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance for asset %', p_asset;
  END IF;

  -- Ledger entry
  INSERT INTO ledger_entries(user_id, asset, account_id, entry_type, debit, credit,
    balance_before, balance_after, reference_id, reference_type, description)
  SELECT p_seller_id, p_asset, la.id, 'p2p_escrow_lock', p_amount, 0,
    la.available_balance + p_amount, la.available_balance,
    p_trade_id, 'p2p_trade', 'P2P escrow locked'
  FROM ledger_accounts la WHERE la.user_id = p_seller_id AND la.asset = p_asset;

  -- Lock in wallets
  UPDATE wallets
    SET balance         = GREATEST(0, balance - p_amount),
        locked_balance  = locked_balance + p_amount,
        escrow_balance  = escrow_balance + p_amount,
        updated_at      = now()
  WHERE user_id = p_seller_id AND asset = p_asset AND wallet_type IN ('spot','p2p');

  -- Upsert into escrows table
  INSERT INTO escrows(seller_id, buyer_id, asset, amount, status, p2p_trade_id)
  VALUES (p_seller_id, v_buyer_id, p_asset, p_amount, 'locked', p_trade_id)
  ON CONFLICT (p2p_trade_id) DO UPDATE
    SET status = 'locked', amount = p_amount, updated_at = now();

  -- Update trade status
  UPDATE p2p_trades
    SET status           = 'awaiting_payment',
        escrow_locked_at = now(),
        payment_due_at   = now() + (p_payment_window || ' minutes')::interval,
        updated_at       = now()
  WHERE id = p_trade_id;
END;
$$;

-- ── 7. p2p_release_escrow — release to buyer + write ledger ──────────────────
CREATE OR REPLACE FUNCTION p2p_release_escrow(
  p_trade_id  uuid,
  p_seller_id uuid,
  p_buyer_id  uuid,
  p_asset     text,
  p_amount    numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Idempotency guard
  IF EXISTS (
    SELECT 1 FROM escrows WHERE p2p_trade_id = p_trade_id AND status = 'released'
  ) THEN RETURN; END IF;

  -- Release seller locked → debit
  UPDATE ledger_accounts
    SET locked_balance    = GREATEST(0, locked_balance - p_amount),
        updated_at        = now()
  WHERE user_id = p_seller_id AND asset = p_asset;

  -- Credit buyer
  UPDATE ledger_accounts
    SET available_balance = available_balance + p_amount,
        updated_at        = now()
  WHERE user_id = p_buyer_id AND asset = p_asset;

  -- Ledger entries for both parties
  INSERT INTO ledger_entries(user_id, asset, account_id, entry_type, debit, credit,
    balance_before, balance_after, reference_id, reference_type, description)
  SELECT p_seller_id, p_asset, la.id, 'p2p_escrow_release_debit', p_amount, 0,
    la.locked_balance + p_amount, la.locked_balance,
    p_trade_id, 'p2p_trade', 'P2P escrow released to buyer (seller debit)'
  FROM ledger_accounts la WHERE la.user_id = p_seller_id AND la.asset = p_asset;

  INSERT INTO ledger_entries(user_id, asset, account_id, entry_type, debit, credit,
    balance_before, balance_after, reference_id, reference_type, description)
  SELECT p_buyer_id, p_asset, la.id, 'p2p_escrow_release_credit', 0, p_amount,
    la.available_balance - p_amount, la.available_balance,
    p_trade_id, 'p2p_trade', 'P2P escrow received (buyer credit)'
  FROM ledger_accounts la WHERE la.user_id = p_buyer_id AND la.asset = p_asset;

  -- Wallets
  UPDATE wallets
    SET locked_balance = GREATEST(0, locked_balance - p_amount),
        escrow_balance = GREATEST(0, escrow_balance - p_amount),
        updated_at     = now()
  WHERE user_id = p_seller_id AND asset = p_asset AND wallet_type IN ('spot','p2p');

  UPDATE wallets
    SET balance    = balance + p_amount,
        updated_at = now()
  WHERE user_id = p_buyer_id AND asset = p_asset AND wallet_type IN ('spot','p2p');

  -- Ensure buyer has a wallet row
  INSERT INTO wallets(user_id, wallet_type, asset, balance)
  VALUES (p_buyer_id, 'spot', p_asset, p_amount)
  ON CONFLICT (user_id, asset, wallet_type) DO UPDATE
    SET balance = wallets.balance + p_amount, updated_at = now();

  -- Mark escrow released
  UPDATE escrows SET status = 'released', updated_at = now()
  WHERE p2p_trade_id = p_trade_id;

  -- Mark trade completed
  UPDATE p2p_trades
    SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_trade_id;
END;
$$;

-- ── 8. p2p_refund_escrow — refund to seller + write ledger ───────────────────
CREATE OR REPLACE FUNCTION p2p_refund_escrow(
  p_trade_id  uuid,
  p_seller_id uuid,
  p_asset     text,
  p_amount    numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Idempotency guard
  IF EXISTS (
    SELECT 1 FROM escrows WHERE p2p_trade_id = p_trade_id AND status IN ('refunded','released')
  ) THEN RETURN; END IF;

  -- Restore seller: locked → available
  UPDATE ledger_accounts
    SET available_balance = available_balance + p_amount,
        locked_balance    = GREATEST(0, locked_balance - p_amount),
        updated_at        = now()
  WHERE user_id = p_seller_id AND asset = p_asset;

  INSERT INTO ledger_entries(user_id, asset, account_id, entry_type, debit, credit,
    balance_before, balance_after, reference_id, reference_type, description)
  SELECT p_seller_id, p_asset, la.id, 'p2p_escrow_refund', 0, p_amount,
    la.available_balance - p_amount, la.available_balance,
    p_trade_id, 'p2p_trade', 'P2P escrow refunded to seller'
  FROM ledger_accounts la WHERE la.user_id = p_seller_id AND la.asset = p_asset;

  UPDATE wallets
    SET balance        = balance + p_amount,
        locked_balance = GREATEST(0, locked_balance - p_amount),
        escrow_balance = GREATEST(0, escrow_balance - p_amount),
        updated_at     = now()
  WHERE user_id = p_seller_id AND asset = p_asset AND wallet_type IN ('spot','p2p');

  UPDATE escrows SET status = 'refunded', updated_at = now()
  WHERE p2p_trade_id = p_trade_id;

  UPDATE p2p_trades
    SET status = 'cancelled', updated_at = now()
  WHERE id = p_trade_id;
END;
$$;
