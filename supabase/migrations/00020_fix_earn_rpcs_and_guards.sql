
-- ── Fix subscribe_earn: wallet_id→account_id, note→description ───────────────
CREATE OR REPLACE FUNCTION subscribe_earn(
  p_user_id     uuid,
  p_product_id  uuid,
  p_amount      numeric,
  p_idempotency text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_product  earn_products%ROWTYPE;
  v_sub_id   uuid;
  v_existing uuid;
  v_acct_id  uuid;
BEGIN
  -- Idempotency
  SELECT id INTO v_existing FROM earn_subscriptions
  WHERE idempotency_key = p_idempotency AND user_id = p_user_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  -- Validate product
  SELECT * INTO v_product FROM earn_products WHERE id = p_product_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found or inactive'; END IF;
  IF p_amount < v_product.min_amount THEN
    RAISE EXCEPTION 'Amount % below minimum % %', p_amount, v_product.min_amount, v_product.asset;
  END IF;

  -- Lock funds in spot wallet (atomic)
  UPDATE wallets
  SET balance        = balance - p_amount,
      locked_balance = locked_balance + p_amount,
      updated_at     = now()
  WHERE user_id    = p_user_id
    AND asset      = v_product.asset
    AND wallet_type = 'spot'
    AND balance    >= p_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient % balance', v_product.asset;
  END IF;

  -- Create subscription
  INSERT INTO earn_subscriptions (
    user_id, product_id, asset, amount, status,
    start_date, end_date, maturity_at, idempotency_key
  ) VALUES (
    p_user_id, p_product_id, v_product.asset, p_amount, 'active',
    CURRENT_DATE,
    CASE WHEN v_product.duration_days IS NOT NULL
         THEN CURRENT_DATE + v_product.duration_days ELSE NULL END,
    CASE WHEN v_product.duration_days IS NOT NULL
         THEN now() + (v_product.duration_days || ' days')::interval ELSE NULL END,
    p_idempotency
  ) RETURNING id INTO v_sub_id;

  -- Ledger entry (account_id nullable — use ledger_accounts if exists)
  SELECT id INTO v_acct_id FROM ledger_accounts
  WHERE user_id = p_user_id AND asset = v_product.asset LIMIT 1;

  INSERT INTO ledger_entries
    (user_id, account_id, entry_type, asset, debit, credit,
     reference_id, reference_type, description)
  VALUES (
    p_user_id, v_acct_id, 'earn_lock', v_product.asset,
    p_amount, 0,
    v_sub_id, 'earn_subscription', 'Earn subscription locked'
  );

  RETURN v_sub_id;
END; $$;

-- ── Fix redeem_earn: wallet_id→account_id, note→description ─────────────────
CREATE OR REPLACE FUNCTION redeem_earn(
  p_user_id uuid,
  p_sub_id  uuid
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sub         earn_subscriptions%ROWTYPE;
  v_product     earn_products%ROWTYPE;
  v_total_yield numeric;
  v_payout      numeric;
  v_acct_id     uuid;
BEGIN
  SELECT * INTO v_sub FROM earn_subscriptions
  WHERE id = p_sub_id AND user_id = p_user_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription not found or already redeemed'; END IF;

  SELECT * INTO v_product FROM earn_products WHERE id = v_sub.product_id;

  -- Enforce lock period on fixed products
  IF v_product.duration_days IS NOT NULL
     AND v_sub.maturity_at IS NOT NULL
     AND v_sub.maturity_at > now() THEN
    RAISE EXCEPTION 'Fixed subscription locked until %',
      to_char(v_sub.maturity_at, 'YYYY-MM-DD');
  END IF;

  -- Sum unsettled yield
  SELECT COALESCE(SUM(yield_amount), 0) INTO v_total_yield
  FROM earn_yield_entries
  WHERE subscription_id = p_sub_id AND settled = false;

  v_payout := v_sub.amount + v_total_yield;

  -- Return principal + yield
  UPDATE wallets
  SET balance        = balance + v_payout,
      locked_balance = GREATEST(locked_balance - v_sub.amount, 0),
      updated_at     = now()
  WHERE user_id = p_user_id AND asset = v_sub.asset AND wallet_type = 'spot';

  -- Settle yield entries
  UPDATE earn_yield_entries
  SET settled = true, settled_at = now()
  WHERE subscription_id = p_sub_id AND settled = false;

  -- Close subscription
  UPDATE earn_subscriptions
  SET status       = 'redeemed',
      redeemed_at  = now(),
      updated_at   = now(),
      earned_total = COALESCE(earned_total, 0) + v_total_yield
  WHERE id = p_sub_id;

  -- Ledger entry
  SELECT id INTO v_acct_id FROM ledger_accounts
  WHERE user_id = p_user_id AND asset = v_sub.asset LIMIT 1;

  INSERT INTO ledger_entries
    (user_id, account_id, entry_type, asset, debit, credit,
     reference_id, reference_type, description)
  VALUES (
    p_user_id, v_acct_id, 'earn_unlock', v_sub.asset,
    0, v_payout,
    p_sub_id, 'earn_redemption', 'Earn redeemed: principal + yield'
  );

  RETURN v_payout;
END; $$;

-- ── Fix accrue_earn_yield: same ledger fix ────────────────────────────────────
CREATE OR REPLACE FUNCTION accrue_earn_yield() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count integer := 0;
  v_rec   RECORD;
  v_daily numeric;
  v_date  date := CURRENT_DATE;
BEGIN
  FOR v_rec IN
    SELECT es.id AS sub_id, es.user_id, es.asset, es.amount, ep.apy
    FROM earn_subscriptions es
    JOIN earn_products ep ON ep.id = es.product_id
    WHERE es.status = 'active'
  LOOP
    v_daily := (v_rec.amount * v_rec.apy / 100.0) / 365.0;
    INSERT INTO earn_yield_entries
      (subscription_id, user_id, asset, yield_amount, accrual_date)
    VALUES (v_rec.sub_id, v_rec.user_id, v_rec.asset, v_daily, v_date)
    ON CONFLICT (subscription_id, accrual_date) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

-- ── ensure_user_wallets: safe init for new users ──────────────────────────────
-- Recreate to also create ledger_accounts if missing
CREATE OR REPLACE FUNCTION ensure_user_wallets(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_assets      text[] := ARRAY['USDT','BTC','ETH','BNB','SOL','XRP','TRX','LTC','DOGE','USDC'];
  v_wallet_types text[] := ARRAY['spot','funding','p2p','escrow','futures','earn'];
  v_asset       text;
  v_wtype       text;
BEGIN
  FOREACH v_asset IN ARRAY v_assets LOOP
    FOREACH v_wtype IN ARRAY v_wallet_types LOOP
      INSERT INTO wallets (user_id, wallet_type, asset, balance, locked_balance,
                           escrow_balance, pending_deposit, pending_withdraw)
      VALUES (p_user_id, v_wtype::wallet_type, v_asset, 0, 0, 0, 0, 0)
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Ensure ledger_accounts row
    INSERT INTO ledger_accounts (user_id, asset, available_balance, locked_balance, pending_balance)
    VALUES (p_user_id, v_asset, 0, 0, 0)
    ON CONFLICT DO NOTHING;
  END LOOP;
END; $$;

-- ── P2P double-release guard: add processed_at idempotency ───────────────────
CREATE OR REPLACE FUNCTION p2p_release_escrow(
  p_trade_id  uuid,
  p_seller_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trade RECORD;
  v_escrow RECORD;
BEGIN
  -- Lock the trade row to prevent race
  SELECT * INTO v_trade FROM p2p_trades
  WHERE id = p_trade_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.seller_id <> p_seller_id THEN
    RAISE EXCEPTION 'Only the seller can release escrow';
  END IF;
  IF v_trade.escrow_released THEN
    RAISE EXCEPTION 'Escrow already released';
  END IF;
  IF v_trade.status NOT IN ('payment_marked', 'awaiting_release') THEN
    RAISE EXCEPTION 'Trade not in releasable state: %', v_trade.status;
  END IF;

  -- Move from escrow → buyer spot wallet
  UPDATE wallets
  SET balance    = balance + v_trade.crypto_amount,
      updated_at = now()
  WHERE user_id    = v_trade.buyer_id
    AND asset      = v_trade.asset
    AND wallet_type = 'spot';

  -- Reduce seller escrow
  UPDATE wallets
  SET escrow_balance = GREATEST(escrow_balance - v_trade.crypto_amount, 0),
      updated_at     = now()
  WHERE user_id    = v_trade.seller_id
    AND asset      = v_trade.asset
    AND wallet_type IN ('escrow', 'spot');

  -- Mark trade released
  UPDATE p2p_trades
  SET status         = 'released',
      escrow_released = true,
      released_at    = now()
  WHERE id = p_trade_id;

  -- Ledger entries
  INSERT INTO ledger_entries (user_id, entry_type, asset, debit, credit,
    reference_id, reference_type, description)
  VALUES
    (v_trade.buyer_id,  'p2p_escrow_release', v_trade.asset,
     0, v_trade.crypto_amount, p_trade_id, 'p2p_trade', 'P2P escrow released to buyer'),
    (v_trade.seller_id, 'p2p_escrow_release', v_trade.asset,
     v_trade.crypto_amount, 0, p_trade_id, 'p2p_trade', 'P2P escrow deducted from seller');
END; $$;

-- ── P2P refund guard ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION p2p_refund_escrow(
  p_trade_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trade RECORD;
BEGIN
  SELECT * INTO v_trade FROM p2p_trades
  WHERE id = p_trade_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.escrow_released THEN
    RAISE EXCEPTION 'Escrow already released — cannot refund';
  END IF;
  IF v_trade.status IN ('released', 'refunded') THEN
    RAISE EXCEPTION 'Trade already settled: %', v_trade.status;
  END IF;

  -- Return to seller spot
  UPDATE wallets
  SET balance        = balance + v_trade.crypto_amount,
      escrow_balance = GREATEST(escrow_balance - v_trade.crypto_amount, 0),
      locked_balance = GREATEST(locked_balance - v_trade.crypto_amount, 0),
      updated_at     = now()
  WHERE user_id    = v_trade.seller_id
    AND asset      = v_trade.asset
    AND wallet_type = 'spot';

  UPDATE p2p_trades
  SET status          = 'refunded',
      escrow_released = false,
      cancelled_at    = now()
  WHERE id = p_trade_id;

  INSERT INTO ledger_entries (user_id, entry_type, asset, debit, credit,
    reference_id, reference_type, description)
  VALUES (v_trade.seller_id, 'refund_credit', v_trade.asset,
    0, v_trade.crypto_amount, p_trade_id, 'p2p_trade', 'P2P escrow refunded to seller');
END; $$;
