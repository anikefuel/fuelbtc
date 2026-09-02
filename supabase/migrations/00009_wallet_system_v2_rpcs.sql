
-- ═══════════════════════════════════════════════════════════════════════════
-- WALLET ATOMIC RPCs — all balance mutations go through these functions
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Helper: get or create wallet row ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_or_create_wallet(
  p_user_id    UUID,
  p_asset      TEXT,
  p_wallet_type wallet_type DEFAULT 'spot'
) RETURNS wallets
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row wallets;
BEGIN
  INSERT INTO wallets(user_id, wallet_type, asset)
  VALUES (p_user_id, p_wallet_type, p_asset)
  ON CONFLICT (user_id, wallet_type, asset) DO NOTHING;

  SELECT * INTO v_row FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type AND asset = p_asset;
  RETURN v_row;
END;
$$;

-- ─── wallet_credit: credit available balance + ledger entry ──────────────────
CREATE OR REPLACE FUNCTION wallet_credit(
  p_user_id     UUID,
  p_asset       TEXT,
  p_amount      NUMERIC,
  p_wallet_type wallet_type DEFAULT 'spot',
  p_entry_type  TEXT DEFAULT 'deposit_credit',
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wallet  wallets;
  v_account ledger_accounts;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Credit amount must be positive'; END IF;

  -- Upsert wallet row
  PERFORM get_or_create_wallet(p_user_id, p_asset, p_wallet_type);

  -- Update wallet balance
  UPDATE wallets
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type AND asset = p_asset;

  -- Upsert ledger_account (legacy compat)
  INSERT INTO ledger_accounts(user_id, asset, available_balance)
  VALUES (p_user_id, p_asset, p_amount)
  ON CONFLICT (user_id, asset) DO UPDATE
  SET available_balance = ledger_accounts.available_balance + p_amount,
      updated_at = NOW();

  SELECT * INTO v_account FROM ledger_accounts WHERE user_id = p_user_id AND asset = p_asset;

  -- Write ledger entry
  INSERT INTO ledger_entries(user_id, account_id, asset, entry_type, amount, credit, debit,
    balance_before, balance_after, reference_id, reference_type, description)
  VALUES (p_user_id, v_account.id, p_asset, p_entry_type, p_amount, p_amount, 0,
    v_account.available_balance - p_amount,
    v_account.available_balance,
    p_reference_id, p_reference_type, p_description);

  -- Audit log
  INSERT INTO wallet_audit_logs(actor_id, target_user_id, action, asset, amount, reference_id, reference_type)
  VALUES (p_user_id, p_user_id, p_entry_type, p_asset, p_amount, p_reference_id, p_reference_type);
END;
$$;

-- ─── wallet_debit: debit available balance + ledger entry ────────────────────
CREATE OR REPLACE FUNCTION wallet_debit(
  p_user_id     UUID,
  p_asset       TEXT,
  p_amount      NUMERIC,
  p_wallet_type wallet_type DEFAULT 'spot',
  p_entry_type  TEXT DEFAULT 'withdrawal_debit',
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wallet  wallets;
  v_account ledger_accounts;
  v_available NUMERIC;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Debit amount must be positive'; END IF;

  SELECT * INTO v_wallet FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type AND asset = p_asset
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found for % %', p_asset, p_wallet_type; END IF;

  v_available := v_wallet.balance - v_wallet.locked_balance - v_wallet.escrow_balance - v_wallet.pending_withdraw;
  IF v_available < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: available=% needed=%', v_available, p_amount;
  END IF;

  UPDATE wallets SET balance = balance - p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type AND asset = p_asset;

  UPDATE ledger_accounts
  SET available_balance = GREATEST(0, available_balance - p_amount), updated_at = NOW()
  WHERE user_id = p_user_id AND asset = p_asset;

  SELECT * INTO v_account FROM ledger_accounts WHERE user_id = p_user_id AND asset = p_asset;

  INSERT INTO ledger_entries(user_id, account_id, asset, entry_type, amount, debit, credit,
    balance_before, balance_after, reference_id, reference_type, description)
  VALUES (p_user_id, v_account.id, p_asset, p_entry_type, p_amount, p_amount, 0,
    v_account.available_balance + p_amount,
    v_account.available_balance,
    p_reference_id, p_reference_type, p_description);

  INSERT INTO wallet_audit_logs(actor_id, target_user_id, action, asset, amount, reference_id, reference_type)
  VALUES (p_user_id, p_user_id, p_entry_type, p_asset, p_amount, p_reference_id, p_reference_type);
END;
$$;

-- ─── wallet_lock: move amount from available→locked ──────────────────────────
CREATE OR REPLACE FUNCTION wallet_lock(
  p_user_id     UUID,
  p_asset       TEXT,
  p_amount      NUMERIC,
  p_wallet_type wallet_type DEFAULT 'spot',
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_wallet wallets;
  v_available NUMERIC;
BEGIN
  SELECT * INTO v_wallet FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type AND asset = p_asset FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;

  v_available := v_wallet.balance - v_wallet.locked_balance - v_wallet.escrow_balance - v_wallet.pending_withdraw;
  IF v_available < p_amount THEN
    RAISE EXCEPTION 'Insufficient available balance for lock: % < %', v_available, p_amount;
  END IF;

  UPDATE wallets SET locked_balance = locked_balance + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type AND asset = p_asset;

  UPDATE ledger_accounts
  SET available_balance = GREATEST(0, available_balance - p_amount),
      locked_balance = locked_balance + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id AND asset = p_asset;
END;
$$;

-- ─── wallet_unlock: move amount from locked→available ────────────────────────
CREATE OR REPLACE FUNCTION wallet_unlock(
  p_user_id     UUID,
  p_asset       TEXT,
  p_amount      NUMERIC,
  p_wallet_type wallet_type DEFAULT 'spot',
  p_reference_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE wallets
  SET locked_balance = GREATEST(0, locked_balance - p_amount), updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type AND asset = p_asset;

  UPDATE ledger_accounts
  SET available_balance = available_balance + p_amount,
      locked_balance = GREATEST(0, locked_balance - p_amount),
      updated_at = NOW()
  WHERE user_id = p_user_id AND asset = p_asset;
END;
$$;

-- ─── wallet_internal_transfer: atomic user→user transfer ─────────────────────
CREATE OR REPLACE FUNCTION wallet_internal_transfer(
  p_sender_id    UUID,
  p_recipient_id UUID,
  p_asset        TEXT,
  p_amount       NUMERIC,
  p_wallet_type  wallet_type DEFAULT 'spot',
  p_note         TEXT DEFAULT NULL,
  p_fee          NUMERIC DEFAULT 0
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_transfer_id UUID;
  v_net         NUMERIC;
  v_ref         TEXT;
BEGIN
  IF p_sender_id = p_recipient_id THEN RAISE EXCEPTION 'Cannot transfer to yourself'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  v_net := p_amount - p_fee;
  v_ref := 'INT-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 8));

  -- Debit sender
  PERFORM wallet_debit(p_sender_id, p_asset, p_amount, p_wallet_type,
    'internal_transfer_debit', NULL, 'internal_transfer', p_note);

  -- Credit recipient (net after fee)
  PERFORM wallet_credit(p_recipient_id, p_asset, v_net, p_wallet_type,
    'internal_transfer_credit', NULL, 'internal_transfer', p_note);

  -- Record transfer
  INSERT INTO internal_transfers(sender_id, recipient_id, asset, wallet_type, amount, fee, net_amount, note, reference)
  VALUES (p_sender_id, p_recipient_id, p_asset, p_wallet_type, p_amount, p_fee, v_net, p_note, v_ref)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

-- ─── wallet_self_transfer: spot↔funding etc. ─────────────────────────────────
CREATE OR REPLACE FUNCTION wallet_self_transfer(
  p_user_id     UUID,
  p_asset       TEXT,
  p_amount      NUMERIC,
  p_from_wallet wallet_type,
  p_to_wallet   wallet_type
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id UUID;
BEGIN
  IF p_from_wallet = p_to_wallet THEN RAISE EXCEPTION 'Source and destination wallets must differ'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  -- Debit from-wallet
  PERFORM wallet_debit(p_user_id, p_asset, p_amount, p_from_wallet,
    'wallet_transfer_out', NULL, 'wallet_transfer',
    'Transfer to ' || p_to_wallet::TEXT || ' wallet');

  -- Credit to-wallet
  PERFORM wallet_credit(p_user_id, p_asset, p_amount, p_to_wallet,
    'wallet_transfer_in', NULL, 'wallet_transfer',
    'Transfer from ' || p_from_wallet::TEXT || ' wallet');

  INSERT INTO wallet_transfers(user_id, asset, from_wallet, to_wallet, amount)
  VALUES (p_user_id, p_asset, p_from_wallet, p_to_wallet, p_amount)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─── wallet_withdrawal_request: lock funds + create withdrawal ────────────────
CREATE OR REPLACE FUNCTION wallet_withdrawal_request(
  p_user_id    UUID,
  p_asset      TEXT,
  p_network    TEXT,
  p_to_address TEXT,
  p_amount     NUMERIC,
  p_memo       TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_fee       NUMERIC;
  v_net       NUMERIC;
  v_wid       UUID;
  v_net_conf  asset_networks%ROWTYPE;
BEGIN
  -- Validate network enabled
  SELECT * INTO v_net_conf FROM asset_networks
  WHERE asset = p_asset AND network = p_network AND is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Network % is not available for %', p_network, p_asset; END IF;
  IF NOT v_net_conf.withdraw_enabled THEN RAISE EXCEPTION 'Withdrawals are currently disabled for % on %', p_asset, p_network; END IF;

  v_fee := v_net_conf.withdrawal_fee;
  v_net := p_amount - v_fee;

  IF v_net <= 0 THEN RAISE EXCEPTION 'Amount after fee must be positive'; END IF;
  IF p_amount < v_net_conf.min_withdrawal THEN
    RAISE EXCEPTION 'Minimum withdrawal is % %', v_net_conf.min_withdrawal, p_asset;
  END IF;

  -- Lock funds immediately
  PERFORM wallet_lock(p_user_id, p_asset, p_amount, 'spot',
    NULL, 'withdrawal_pending');

  -- Update pending_withdraw counter
  UPDATE wallets SET pending_withdraw = pending_withdraw + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = 'spot' AND asset = p_asset;

  -- Create withdrawal record
  INSERT INTO withdrawals(user_id, asset, network, to_address, memo, amount, fee, net_amount, status)
  VALUES (p_user_id, p_asset, p_network, p_to_address, p_memo, p_amount, v_fee, v_net, 'pending')
  RETURNING id INTO v_wid;

  -- Audit log
  INSERT INTO wallet_audit_logs(actor_id, target_user_id, action, asset, amount, reference_id, reference_type)
  VALUES (p_user_id, p_user_id, 'withdrawal_requested', p_asset, p_amount, v_wid, 'withdrawal');

  RETURN v_wid;
END;
$$;

-- ─── wallet_withdrawal_complete: finalize approved withdrawal ─────────────────
CREATE OR REPLACE FUNCTION wallet_withdrawal_complete(
  p_withdrawal_id UUID,
  p_tx_hash TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_wd withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO v_wd FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_wd.status NOT IN ('approved','pending') THEN RAISE EXCEPTION 'Cannot complete withdrawal in status %', v_wd.status; END IF;

  -- Release locked funds and debit
  PERFORM wallet_unlock(v_wd.user_id, v_wd.asset, v_wd.amount, 'spot', p_withdrawal_id);
  PERFORM wallet_debit(v_wd.user_id, v_wd.asset, v_wd.amount, 'spot',
    'withdrawal_debit', p_withdrawal_id, 'withdrawal',
    'Withdrawal completed: ' || COALESCE(p_tx_hash, 'manual'));

  UPDATE wallets
  SET pending_withdraw = GREATEST(0, pending_withdraw - v_wd.amount), updated_at = NOW()
  WHERE user_id = v_wd.user_id AND wallet_type = 'spot' AND asset = v_wd.asset;

  UPDATE withdrawals
  SET status = 'completed', tx_hash = p_tx_hash, updated_at = NOW()
  WHERE id = p_withdrawal_id;
END;
$$;

-- ─── wallet_withdrawal_cancel: return locked funds ────────────────────────────
CREATE OR REPLACE FUNCTION wallet_withdrawal_cancel(
  p_withdrawal_id UUID,
  p_reason TEXT DEFAULT 'Cancelled'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_wd withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO v_wd FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_wd.status NOT IN ('pending','security_review') THEN
    RAISE EXCEPTION 'Cannot cancel withdrawal in status %', v_wd.status;
  END IF;

  PERFORM wallet_unlock(v_wd.user_id, v_wd.asset, v_wd.amount, 'spot', p_withdrawal_id);

  UPDATE wallets
  SET pending_withdraw = GREATEST(0, pending_withdraw - v_wd.amount), updated_at = NOW()
  WHERE user_id = v_wd.user_id AND wallet_type = 'spot' AND asset = v_wd.asset;

  UPDATE withdrawals
  SET status = 'cancelled', rejection_reason = p_reason, updated_at = NOW()
  WHERE id = p_withdrawal_id;
END;
$$;

-- ─── wallet_deposit_credit: credit confirmed deposit ─────────────────────────
CREATE OR REPLACE FUNCTION wallet_deposit_credit(
  p_deposit_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_dep deposits%ROWTYPE;
BEGIN
  SELECT * INTO v_dep FROM deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit not found'; END IF;
  IF v_dep.status <> 'confirming' THEN RAISE EXCEPTION 'Deposit not ready to credit, status: %', v_dep.status; END IF;

  PERFORM wallet_credit(v_dep.user_id, v_dep.asset, v_dep.amount - v_dep.fee, 'spot',
    'deposit_credit', p_deposit_id, 'deposit',
    'Deposit confirmed: ' || COALESCE(v_dep.tx_hash, 'manual'));

  UPDATE deposits SET status = 'credited', credited_at = NOW()
  WHERE id = p_deposit_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_or_create_wallet(UUID, TEXT, wallet_type)              TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_credit(UUID,TEXT,NUMERIC,wallet_type,TEXT,UUID,TEXT,TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_debit(UUID,TEXT,NUMERIC,wallet_type,TEXT,UUID,TEXT,TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_lock(UUID,TEXT,NUMERIC,wallet_type,UUID,TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_unlock(UUID,TEXT,NUMERIC,wallet_type,UUID)                 TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_internal_transfer(UUID,UUID,TEXT,NUMERIC,wallet_type,TEXT,NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_self_transfer(UUID,TEXT,NUMERIC,wallet_type,wallet_type)   TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_withdrawal_request(UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_withdrawal_complete(UUID,TEXT)                             TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_withdrawal_cancel(UUID,TEXT)                               TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_deposit_credit(UUID)                                       TO authenticated;
