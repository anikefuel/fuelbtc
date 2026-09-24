
-- Add user_id to exchange_provider_configs so sync knows which account to credit
ALTER TABLE exchange_provider_configs ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════
-- RPC: settle_matched_orders
-- Atomically settles a matched buy+sell pair:
--   1. Credits base asset to buyer, debits quote asset from buyer
--   2. Credits quote asset to seller, debits base asset from seller
--   3. Deducts fees from each side
--   4. Updates order filled_qty / remaining_qty / status
--   5. Writes wallet_ledger entries for full audit trail
--   6. Inserts into order_match_log
-- Uses optimistic locking: fails if either order is no longer 'open'
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION settle_matched_orders(
  p_buy_order_id  uuid,
  p_sell_order_id uuid,
  p_match_qty     numeric,
  p_match_price   numeric,
  p_fee_buy       numeric DEFAULT 0,   -- fee in base asset (buyer pays)
  p_fee_sell      numeric DEFAULT 0    -- fee in quote asset (seller pays)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_buy       record;
  v_sell      record;
  v_cost      numeric;  -- quote amount transferred buyer→seller
  v_new_buy_remaining  numeric;
  v_new_sell_remaining numeric;
BEGIN
  -- Lock both orders in consistent order (lower id first) to prevent deadlock
  IF p_buy_order_id < p_sell_order_id THEN
    SELECT * INTO v_buy  FROM orders WHERE id = p_buy_order_id  FOR UPDATE;
    SELECT * INTO v_sell FROM orders WHERE id = p_sell_order_id FOR UPDATE;
  ELSE
    SELECT * INTO v_sell FROM orders WHERE id = p_sell_order_id FOR UPDATE;
    SELECT * INTO v_buy  FROM orders WHERE id = p_buy_order_id  FOR UPDATE;
  END IF;

  -- Idempotency / optimistic lock: both must still be open with sufficient remaining
  IF v_buy.status_v2 NOT IN ('open','pending') THEN
    RAISE EXCEPTION 'Buy order % no longer open (status=%)', p_buy_order_id, v_buy.status_v2;
  END IF;
  IF v_sell.status_v2 NOT IN ('open','pending') THEN
    RAISE EXCEPTION 'Sell order % no longer open (status=%)', p_sell_order_id, v_sell.status_v2;
  END IF;
  IF v_buy.remaining_qty < p_match_qty THEN
    RAISE EXCEPTION 'Buy order insufficient remaining qty';
  END IF;
  IF v_sell.remaining_qty < p_match_qty THEN
    RAISE EXCEPTION 'Sell order insufficient remaining qty';
  END IF;

  v_cost := p_match_qty * p_match_price;

  -- ── Buyer: receives base asset, spends quote asset ──────────────────
  -- Ensure buyer has quote wallet
  INSERT INTO wallets (id, user_id, asset, wallet_type, available_balance, locked_balance, total_balance, updated_at)
  VALUES (gen_random_uuid(), v_buy.user_id, v_buy.quote_asset, 'spot', 0, 0, 0, now())
  ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

  -- Debit quote from buyer (may come from locked_balance if limit order pre-locked)
  UPDATE wallets
     SET locked_balance    = GREATEST(0, locked_balance - (v_cost + p_fee_sell)),
         available_balance = available_balance - GREATEST(0, (v_cost + p_fee_sell) - locked_balance),
         total_balance     = total_balance - (v_cost + p_fee_sell),
         updated_at        = now()
   WHERE user_id = v_buy.user_id AND asset = v_buy.quote_asset AND wallet_type = 'spot';

  -- Credit base to buyer (get or create wallet)
  INSERT INTO wallets (id, user_id, asset, wallet_type, available_balance, locked_balance, total_balance, updated_at)
  VALUES (gen_random_uuid(), v_buy.user_id, v_buy.base_asset, 'spot', 0, 0, 0, now())
  ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

  UPDATE wallets
     SET available_balance = available_balance + (p_match_qty - p_fee_buy),
         total_balance     = total_balance     + (p_match_qty - p_fee_buy),
         updated_at        = now()
   WHERE user_id = v_buy.user_id AND asset = v_buy.base_asset AND wallet_type = 'spot';

  -- ── Seller: receives quote asset, spends base asset ─────────────────
  INSERT INTO wallets (id, user_id, asset, wallet_type, available_balance, locked_balance, total_balance, updated_at)
  VALUES (gen_random_uuid(), v_sell.user_id, v_sell.base_asset, 'spot', 0, 0, 0, now())
  ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

  UPDATE wallets
     SET locked_balance    = GREATEST(0, locked_balance - p_match_qty),
         available_balance = available_balance - GREATEST(0, p_match_qty - locked_balance),
         total_balance     = total_balance - p_match_qty,
         updated_at        = now()
   WHERE user_id = v_sell.user_id AND asset = v_sell.base_asset AND wallet_type = 'spot';

  INSERT INTO wallets (id, user_id, asset, wallet_type, available_balance, locked_balance, total_balance, updated_at)
  VALUES (gen_random_uuid(), v_sell.user_id, v_sell.quote_asset, 'spot', 0, 0, 0, now())
  ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

  UPDATE wallets
     SET available_balance = available_balance + (v_cost - p_fee_sell),
         total_balance     = total_balance     + (v_cost - p_fee_sell),
         updated_at        = now()
   WHERE user_id = v_sell.user_id AND asset = v_sell.quote_asset AND wallet_type = 'spot';

  -- ── Wallet ledger entries ────────────────────────────────────────────
  -- Buyer debit quote
  INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount, balance_before, balance_after, reference_type, reference_id, description, created_at)
  SELECT gen_random_uuid(), w.id, v_buy.user_id, 'trade_debit', v_buy.quote_asset,
         -(v_cost + p_fee_sell), w.total_balance + (v_cost + p_fee_sell), w.total_balance,
         'order', p_buy_order_id, 'Matched buy ' || v_buy.symbol || ' @' || p_match_price, now()
    FROM wallets w WHERE w.user_id = v_buy.user_id AND w.asset = v_buy.quote_asset AND w.wallet_type = 'spot';

  -- Buyer credit base
  INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount, balance_before, balance_after, reference_type, reference_id, description, created_at)
  SELECT gen_random_uuid(), w.id, v_buy.user_id, 'trade_credit', v_buy.base_asset,
         p_match_qty - p_fee_buy, w.total_balance - (p_match_qty - p_fee_buy), w.total_balance,
         'order', p_buy_order_id, 'Matched buy received ' || v_buy.base_asset, now()
    FROM wallets w WHERE w.user_id = v_buy.user_id AND w.asset = v_buy.base_asset AND w.wallet_type = 'spot';

  -- Seller debit base
  INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount, balance_before, balance_after, reference_type, reference_id, description, created_at)
  SELECT gen_random_uuid(), w.id, v_sell.user_id, 'trade_debit', v_sell.base_asset,
         -p_match_qty, w.total_balance + p_match_qty, w.total_balance,
         'order', p_sell_order_id, 'Matched sell ' || v_sell.symbol || ' @' || p_match_price, now()
    FROM wallets w WHERE w.user_id = v_sell.user_id AND w.asset = v_sell.base_asset AND w.wallet_type = 'spot';

  -- Seller credit quote
  INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount, balance_before, balance_after, reference_type, reference_id, description, created_at)
  SELECT gen_random_uuid(), w.id, v_sell.user_id, 'trade_credit', v_sell.quote_asset,
         v_cost - p_fee_sell, w.total_balance - (v_cost - p_fee_sell), w.total_balance,
         'order', p_sell_order_id, 'Matched sell received ' || v_sell.quote_asset, now()
    FROM wallets w WHERE w.user_id = v_sell.user_id AND w.asset = v_sell.quote_asset AND w.wallet_type = 'spot';

  -- ── Update order fill state ──────────────────────────────────────────
  v_new_buy_remaining  := v_buy.remaining_qty  - p_match_qty;
  v_new_sell_remaining := v_sell.remaining_qty - p_match_qty;

  UPDATE orders SET
    filled_qty     = filled_qty + p_match_qty,
    remaining_qty  = v_new_buy_remaining,
    avg_fill_price = p_match_price,
    fee            = fee + p_fee_buy,
    status_v2      = CASE WHEN v_new_buy_remaining <= 0 THEN 'filled' ELSE 'open' END,
    updated_at     = now()
  WHERE id = p_buy_order_id;

  UPDATE orders SET
    filled_qty     = filled_qty + p_match_qty,
    remaining_qty  = v_new_sell_remaining,
    avg_fill_price = p_match_price,
    fee            = fee + p_fee_sell,
    status_v2      = CASE WHEN v_new_sell_remaining <= 0 THEN 'filled' ELSE 'open' END,
    updated_at     = now()
  WHERE id = p_sell_order_id;

  -- ── Match log ────────────────────────────────────────────────────────
  INSERT INTO order_match_log (buy_order_id, sell_order_id, symbol, matched_qty, match_price, fee_buy, fee_sell)
  VALUES (p_buy_order_id, p_sell_order_id, v_buy.symbol, p_match_qty, p_match_price, p_fee_buy, p_fee_sell);

END;
$$;

GRANT EXECUTE ON FUNCTION settle_matched_orders(uuid, uuid, numeric, numeric, numeric, numeric) TO service_role;
