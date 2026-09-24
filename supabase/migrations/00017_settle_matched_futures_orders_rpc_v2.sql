
-- Extend order_match_log to support futures
ALTER TABLE order_match_log ADD COLUMN IF NOT EXISTS market_type text DEFAULT 'spot';
ALTER TABLE order_match_log ADD COLUMN IF NOT EXISTS mark_price  numeric;

-- ═══════════════════════════════════════════════════════════════════
-- RPC: settle_matched_futures_orders
-- Uses the existing `positions` table (size, liq_price columns)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION settle_matched_futures_orders(
  p_buy_order_id  uuid,
  p_sell_order_id uuid,
  p_match_qty     numeric,
  p_match_price   numeric,
  p_mark_price    numeric,
  p_fee_buy       numeric DEFAULT 0,
  p_fee_sell      numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_buy   record;
  v_sell  record;
  v_new_buy_remaining  numeric;
  v_new_sell_remaining numeric;
  v_notional           numeric;
  v_buy_margin         numeric;
  v_sell_margin        numeric;
  v_buy_liq_price      numeric;
  v_sell_liq_price     numeric;
BEGIN
  -- Lock in consistent order to prevent deadlock
  IF p_buy_order_id < p_sell_order_id THEN
    SELECT * INTO v_buy  FROM orders WHERE id = p_buy_order_id  FOR UPDATE;
    SELECT * INTO v_sell FROM orders WHERE id = p_sell_order_id FOR UPDATE;
  ELSE
    SELECT * INTO v_sell FROM orders WHERE id = p_sell_order_id FOR UPDATE;
    SELECT * INTO v_buy  FROM orders WHERE id = p_buy_order_id  FOR UPDATE;
  END IF;

  IF v_buy.status_v2  NOT IN ('open','pending') THEN RAISE EXCEPTION 'Buy order % no longer open', p_buy_order_id; END IF;
  IF v_sell.status_v2 NOT IN ('open','pending') THEN RAISE EXCEPTION 'Sell order % no longer open', p_sell_order_id; END IF;
  IF v_buy.remaining_qty  < p_match_qty THEN RAISE EXCEPTION 'Buy insufficient qty';  END IF;
  IF v_sell.remaining_qty < p_match_qty THEN RAISE EXCEPTION 'Sell insufficient qty'; END IF;

  v_notional    := p_match_qty * p_match_price;
  v_buy_margin  := v_notional / GREATEST(v_buy.leverage_v2,  1) + p_fee_buy;
  v_sell_margin := v_notional / GREATEST(v_sell.leverage_v2, 1) + p_fee_sell;
  v_buy_liq_price  := p_match_price * (1 - 1.0 / GREATEST(v_buy.leverage_v2,  1) + 0.005);
  v_sell_liq_price := p_match_price * (1 + 1.0 / GREATEST(v_sell.leverage_v2, 1) - 0.005);

  -- Ensure futures wallets exist
  INSERT INTO wallets (id, user_id, asset, wallet_type, available_balance, locked_balance, total_balance, updated_at)
  VALUES (gen_random_uuid(), v_buy.user_id,  v_buy.quote_asset,  'futures', 0, 0, 0, now())
  ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

  INSERT INTO wallets (id, user_id, asset, wallet_type, available_balance, locked_balance, total_balance, updated_at)
  VALUES (gen_random_uuid(), v_sell.user_id, v_sell.quote_asset, 'futures', 0, 0, 0, now())
  ON CONFLICT (user_id, asset, wallet_type) DO NOTHING;

  -- Debit margin from buyer
  UPDATE wallets
     SET available_balance = available_balance - v_buy_margin,
         locked_balance    = locked_balance    + v_buy_margin,
         updated_at        = now()
   WHERE user_id = v_buy.user_id AND asset = v_buy.quote_asset AND wallet_type = 'futures';

  -- Debit margin from seller
  UPDATE wallets
     SET available_balance = available_balance - v_sell_margin,
         locked_balance    = locked_balance    + v_sell_margin,
         updated_at        = now()
   WHERE user_id = v_sell.user_id AND asset = v_sell.quote_asset AND wallet_type = 'futures';

  -- Open/update buyer long position (uses `positions` table with `size` + `liq_price`)
  INSERT INTO positions (
    id, user_id, symbol, side, entry_price, mark_price, liq_price,
    size, notional, leverage, margin_mode,
    initial_margin, maint_margin, margin_ratio,
    unrealized_pnl, realized_pnl, cum_funding_fee,
    provider_name, opened_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_buy.user_id, v_buy.symbol, 'long',
    p_match_price, p_mark_price, v_buy_liq_price,
    p_match_qty, v_notional, v_buy.leverage_v2, v_buy.margin_mode::margin_mode_type,
    v_buy_margin, v_buy_margin * 0.005, v_buy_margin * 0.005 / NULLIF(v_buy_margin, 0),
    0, 0, 0,
    'internal', now(), now()
  )
  ON CONFLICT (user_id, symbol, side) DO UPDATE SET
    size           = positions.size + p_match_qty,
    notional       = positions.notional + v_notional,
    entry_price    = (positions.entry_price * positions.size + p_match_price * p_match_qty)
                     / (positions.size + p_match_qty),
    mark_price     = p_mark_price,
    liq_price      = v_buy_liq_price,
    initial_margin = positions.initial_margin + v_buy_margin,
    updated_at     = now();

  -- Open/update seller short position
  INSERT INTO positions (
    id, user_id, symbol, side, entry_price, mark_price, liq_price,
    size, notional, leverage, margin_mode,
    initial_margin, maint_margin, margin_ratio,
    unrealized_pnl, realized_pnl, cum_funding_fee,
    provider_name, opened_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_sell.user_id, v_sell.symbol, 'short',
    p_match_price, p_mark_price, v_sell_liq_price,
    p_match_qty, v_notional, v_sell.leverage_v2, v_sell.margin_mode::margin_mode_type,
    v_sell_margin, v_sell_margin * 0.005, v_sell_margin * 0.005 / NULLIF(v_sell_margin, 0),
    0, 0, 0,
    'internal', now(), now()
  )
  ON CONFLICT (user_id, symbol, side) DO UPDATE SET
    size           = positions.size + p_match_qty,
    notional       = positions.notional + v_notional,
    entry_price    = (positions.entry_price * positions.size + p_match_price * p_match_qty)
                     / (positions.size + p_match_qty),
    mark_price     = p_mark_price,
    liq_price      = v_sell_liq_price,
    initial_margin = positions.initial_margin + v_sell_margin,
    updated_at     = now();

  -- Wallet ledger entries
  INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount,
    balance_before, balance_after, reference_type, reference_id, description, created_at)
  SELECT gen_random_uuid(), w.id, v_buy.user_id, 'futures_margin_lock', v_buy.quote_asset,
         -v_buy_margin, w.available_balance + v_buy_margin, w.available_balance,
         'order', p_buy_order_id, 'Futures long margin ' || v_buy.symbol, now()
    FROM wallets w WHERE w.user_id = v_buy.user_id AND w.asset = v_buy.quote_asset AND w.wallet_type = 'futures';

  INSERT INTO wallet_ledger (id, wallet_id, user_id, transaction_type, asset, amount,
    balance_before, balance_after, reference_type, reference_id, description, created_at)
  SELECT gen_random_uuid(), w.id, v_sell.user_id, 'futures_margin_lock', v_sell.quote_asset,
         -v_sell_margin, w.available_balance + v_sell_margin, w.available_balance,
         'order', p_sell_order_id, 'Futures short margin ' || v_sell.symbol, now()
    FROM wallets w WHERE w.user_id = v_sell.user_id AND w.asset = v_sell.quote_asset AND w.wallet_type = 'futures';

  -- Update order fill state
  v_new_buy_remaining  := v_buy.remaining_qty  - p_match_qty;
  v_new_sell_remaining := v_sell.remaining_qty - p_match_qty;

  UPDATE orders SET
    filled_qty = filled_qty + p_match_qty, remaining_qty = v_new_buy_remaining,
    avg_fill_price = p_match_price, fee = fee + p_fee_buy,
    status_v2 = CASE WHEN v_new_buy_remaining <= 0 THEN 'filled' ELSE 'open' END,
    updated_at = now()
  WHERE id = p_buy_order_id;

  UPDATE orders SET
    filled_qty = filled_qty + p_match_qty, remaining_qty = v_new_sell_remaining,
    avg_fill_price = p_match_price, fee = fee + p_fee_sell,
    status_v2 = CASE WHEN v_new_sell_remaining <= 0 THEN 'filled' ELSE 'open' END,
    updated_at = now()
  WHERE id = p_sell_order_id;

  -- Match log
  INSERT INTO order_match_log (buy_order_id, sell_order_id, symbol, matched_qty, match_price, mark_price, fee_buy, fee_sell, market_type)
  VALUES (p_buy_order_id, p_sell_order_id, v_buy.symbol, p_match_qty, p_match_price, p_mark_price, p_fee_buy, p_fee_sell, 'futures');
END;
$$;

GRANT EXECUTE ON FUNCTION settle_matched_futures_orders(uuid, uuid, numeric, numeric, numeric, numeric, numeric) TO service_role;
