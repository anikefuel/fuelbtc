
-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 9: Spot Trading Execution Engine
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. order_audit_logs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_audit_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id),
  user_id           uuid NOT NULL REFERENCES auth.users(id),
  event_type        text NOT NULL,
  old_status        text,
  new_status        text,
  fill_qty          numeric(30,10),
  fill_price        numeric(30,10),
  provider_order_id text,
  provider_fill_id  text,
  locked_amount     numeric(30,10),
  released_amount   numeric(30,10),
  error_message     text,
  actor             text NOT NULL DEFAULT 'system',
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_order_id ON order_audit_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_id  ON order_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON order_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event    ON order_audit_logs(event_type);

ALTER TABLE order_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aud_user_select" ON order_audit_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "aud_admin_all"   ON order_audit_logs FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() ->> 'role') = 'admin');

-- ── 2. Extend orders: idempotency_key, quote_amount, avg_fill_price, fee_asset, provider_fill_ids
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key   text,
  ADD COLUMN IF NOT EXISTS quote_amount      numeric(30,10),
  ADD COLUMN IF NOT EXISTS avg_fill_price    numeric(30,10),
  ADD COLUMN IF NOT EXISTS fee_asset         text,
  ADD COLUMN IF NOT EXISTS provider_fill_ids jsonb NOT NULL DEFAULT '[]';

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON orders(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_provider_order_id
  ON orders(provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status_spot
  ON orders(status_v2, market_type_v2, created_at DESC) WHERE market_type_v2 = 'spot';

-- ── 3. Extend trading_pairs ───────────────────────────────────────────────────
ALTER TABLE trading_pairs
  ADD COLUMN IF NOT EXISTS tick_size        numeric(20,10),
  ADD COLUMN IF NOT EXISTS step_size        numeric(20,10),
  ADD COLUMN IF NOT EXISTS min_qty          numeric(20,10) NOT NULL DEFAULT 0.00001,
  ADD COLUMN IF NOT EXISTS max_qty          numeric(20,10),
  ADD COLUMN IF NOT EXISTS is_spot_ok       boolean        NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS spot_paused      boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maker_fee        numeric(10,6)  NOT NULL DEFAULT 0.001,
  ADD COLUMN IF NOT EXISTS taker_fee        numeric(10,6)  NOT NULL DEFAULT 0.001,
  ADD COLUMN IF NOT EXISTS binance_symbol   text,
  ADD COLUMN IF NOT EXISTS binance_filters  jsonb          NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_filter_sync timestamptz;

-- ── 4. trading_settings: global flags ────────────────────────────────────────
INSERT INTO trading_settings (key, value, description)
VALUES ('spot_trading_enabled', 'true'::jsonb, 'Global spot trading kill-switch')
ON CONFLICT (key) DO NOTHING;

INSERT INTO trading_settings (key, value, description)
VALUES ('spot_market_price_buffer', '0.01'::jsonb, 'Extra quote buffer for market buy (fraction)')
ON CONFLICT (key) DO NOTHING;

-- ── 5. Seed default trading pairs ────────────────────────────────────────────
INSERT INTO trading_pairs (symbol, base_asset, quote_asset, binance_symbol, is_spot_ok, is_futures_ok, maker_fee, taker_fee, min_notional, min_qty, price_precision, qty_precision, step_size, tick_size, sort_order, status_v2, provider_symbol)
VALUES
  ('BTCUSDT',  'BTC',  'USDT', 'BTCUSDT',  true, true,  0.001, 0.001, 10, 0.00001, 2, 5, 0.00001,  0.01,     1, 'active', 'BTCUSDT'),
  ('ETHUSDT',  'ETH',  'USDT', 'ETHUSDT',  true, true,  0.001, 0.001, 10, 0.0001,  2, 4, 0.0001,   0.01,     2, 'active', 'ETHUSDT'),
  ('BNBUSDT',  'BNB',  'USDT', 'BNBUSDT',  true, true,  0.001, 0.001, 10, 0.001,   2, 3, 0.001,    0.01,     3, 'active', 'BNBUSDT'),
  ('SOLUSDT',  'SOL',  'USDT', 'SOLUSDT',  true, true,  0.001, 0.001, 10, 0.001,   3, 3, 0.001,    0.001,    4, 'active', 'SOLUSDT'),
  ('XRPUSDT',  'XRP',  'USDT', 'XRPUSDT',  true, true,  0.001, 0.001, 10, 0.1,     4, 1, 0.1,      0.0001,   5, 'active', 'XRPUSDT'),
  ('DOGEUSDT', 'DOGE', 'USDT', 'DOGEUSDT', true, false, 0.001, 0.001, 10, 1,       5, 0, 1,        0.00001,  6, 'active', 'DOGEUSDT'),
  ('TRXUSDT',  'TRX',  'USDT', 'TRXUSDT',  true, false, 0.001, 0.001, 10, 1,       5, 0, 1,        0.000001, 7, 'active', 'TRXUSDT'),
  ('LTCUSDT',  'LTC',  'USDT', 'LTCUSDT',  true, false, 0.001, 0.001, 10, 0.001,   2, 3, 0.001,    0.01,     8, 'active', 'LTCUSDT'),
  ('USDCUSDT', 'USDC', 'USDT', 'USDCUSDT', true, false, 0.001, 0.001, 10, 1,       4, 0, 1,        0.0001,   9, 'active', 'USDCUSDT')
ON CONFLICT (symbol) DO UPDATE SET
  binance_symbol  = EXCLUDED.binance_symbol,
  is_spot_ok      = EXCLUDED.is_spot_ok,
  maker_fee       = EXCLUDED.maker_fee,
  taker_fee       = EXCLUDED.taker_fee,
  min_notional    = EXCLUDED.min_notional,
  min_qty         = EXCLUDED.min_qty,
  price_precision = EXCLUDED.price_precision,
  qty_precision   = EXCLUDED.qty_precision,
  step_size       = EXCLUDED.step_size,
  tick_size       = EXCLUDED.tick_size,
  sort_order      = EXCLUDED.sort_order,
  provider_symbol = EXCLUDED.provider_symbol;

-- ── 6. RPC: settle_binance_fill ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_binance_fill(
  p_order_id         uuid,
  p_provider_fill_id text,
  p_fill_qty         numeric,
  p_fill_price       numeric,
  p_fee              numeric  DEFAULT 0,
  p_fee_asset        text     DEFAULT 'USDT',
  p_is_maker         boolean  DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order         orders%ROWTYPE;
  v_new_filled    numeric;
  v_new_status    text;
  v_receive_asset text;
  v_receive_amt   numeric;
  v_deduct_asset  text;
  v_deduct_amt    numeric;
  v_new_avg_price numeric;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- Idempotency
  IF v_order.provider_fill_ids @> jsonb_build_array(p_provider_fill_id) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  v_new_filled := LEAST(v_order.filled_qty + p_fill_qty, v_order.quantity);
  v_new_avg_price := CASE
    WHEN COALESCE(v_order.filled_qty, 0) = 0 THEN p_fill_price
    ELSE (COALESCE(v_order.avg_fill_price, 0) * COALESCE(v_order.filled_qty, 0) + p_fill_price * p_fill_qty)
         / v_new_filled
  END;
  v_new_status := CASE
    WHEN v_new_filled >= v_order.quantity * 0.9999 THEN 'filled'
    ELSE 'partially_filled'
  END;

  IF v_order.side = 'buy' THEN
    v_deduct_asset  := v_order.quote_asset;
    v_deduct_amt    := p_fill_qty * p_fill_price;
    v_receive_asset := v_order.base_asset;
    v_receive_amt   := p_fill_qty - p_fee;
  ELSE
    v_deduct_asset  := v_order.base_asset;
    v_deduct_amt    := p_fill_qty;
    v_receive_asset := v_order.quote_asset;
    v_receive_amt   := p_fill_qty * p_fill_price - p_fee;
  END IF;

  UPDATE wallets SET
    locked_balance = GREATEST(0, locked_balance - v_deduct_amt),
    updated_at     = now()
  WHERE user_id = v_order.user_id AND asset = v_deduct_asset AND wallet_type = 'spot';

  INSERT INTO wallets (user_id, wallet_type, asset, balance, available_balance, locked_balance)
  VALUES (v_order.user_id, 'spot', v_receive_asset, 0, 0, 0)
  ON CONFLICT (user_id, wallet_type, asset) DO NOTHING;

  UPDATE wallets SET
    available_balance = available_balance + v_receive_amt,
    updated_at        = now()
  WHERE user_id = v_order.user_id AND asset = v_receive_asset AND wallet_type = 'spot';

  UPDATE orders SET
    filled_qty        = v_new_filled,
    avg_fill_price    = v_new_avg_price,
    fee               = COALESCE(fee, 0) + p_fee,
    fee_asset         = p_fee_asset,
    status            = v_new_status::order_status,
    status_v2         = v_new_status::order_status,
    provider_fill_ids = provider_fill_ids || jsonb_build_array(p_provider_fill_id),
    updated_at        = now()
  WHERE id = p_order_id;

  INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
  VALUES
    (v_order.user_id, v_receive_asset, 'spot_fill_credit', v_receive_amt, 0,
     p_order_id, 'order', format('Binance fill received %s %s @ %s (fill=%s)', v_receive_amt, v_receive_asset, p_fill_price, p_provider_fill_id)),
    (v_order.user_id, v_deduct_asset,  'spot_fill_debit',  0, v_deduct_amt,
     p_order_id, 'order', format('Binance fill spent %s %s (fill=%s)', v_deduct_amt, v_deduct_asset, p_provider_fill_id));

  IF p_fee > 0 THEN
    INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
    VALUES (v_order.user_id, p_fee_asset, 'spot_fee', 0, p_fee,
            p_order_id, 'order', format('Spot fee %s %s (fill=%s)', p_fee, p_fee_asset, p_provider_fill_id));
  END IF;

  INSERT INTO order_audit_logs (order_id, user_id, event_type, old_status, new_status, fill_qty, fill_price, provider_fill_id, actor)
  VALUES (p_order_id, v_order.user_id,
          CASE WHEN v_new_status = 'filled' THEN 'fill' ELSE 'partial_fill' END,
          v_order.status_v2::text, v_new_status,
          p_fill_qty, p_fill_price, p_provider_fill_id, 'system');

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'new_status', v_new_status, 'filled_qty', v_new_filled, 'avg_fill_price', v_new_avg_price);
END;
$$;

-- ── 7. RPC: submit_spot_order_provider ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_spot_order_provider(
  p_order_id          uuid,
  p_user_id           uuid,
  p_provider_order_id text,
  p_provider_name     text DEFAULT 'binance',
  p_provider_status   text DEFAULT 'NEW',
  p_response          jsonb DEFAULT '{}'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE orders SET
    provider_order_id = p_provider_order_id,
    provider_name     = p_provider_name,
    status_v2         = 'open',
    status            = 'open',
    updated_at        = now()
  WHERE id = p_order_id AND user_id = p_user_id;

  INSERT INTO provider_orders (order_id, provider_name, provider_order_id, provider_symbol, provider_status, response_payload)
  SELECT p_order_id, p_provider_name, p_provider_order_id, o.symbol, p_provider_status, p_response
  FROM orders o WHERE o.id = p_order_id;

  INSERT INTO order_audit_logs (order_id, user_id, event_type, old_status, new_status, provider_order_id, actor)
  VALUES (p_order_id, p_user_id, 'submitted', 'pending', 'open', p_provider_order_id, 'system');
END;
$$;

-- ── 8. RPC: fail_spot_order ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_spot_order(
  p_order_id uuid,
  p_user_id  uuid,
  p_reason   text DEFAULT 'provider_rejection'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_release_asset text;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_release_asset := CASE WHEN v_order.side = 'buy' THEN v_order.quote_asset ELSE v_order.base_asset END;

  UPDATE orders SET
    status        = 'failed',
    status_v2     = 'failed',
    reject_reason = p_reason,
    updated_at    = now()
  WHERE id = p_order_id;

  IF COALESCE(v_order.locked_amount, 0) > 0 AND v_release_asset IS NOT NULL THEN
    UPDATE wallets SET
      available_balance = available_balance + v_order.locked_amount,
      locked_balance    = GREATEST(0, locked_balance - v_order.locked_amount),
      updated_at        = now()
    WHERE user_id = p_user_id AND asset = v_release_asset AND wallet_type = 'spot';

    INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
    VALUES (p_user_id, v_release_asset, 'lock_release', v_order.locked_amount, 0,
            p_order_id, 'order', format('Lock released: order failed (%s)', p_reason));
  END IF;

  INSERT INTO order_audit_logs (order_id, user_id, event_type, old_status, new_status, error_message, actor)
  VALUES (p_order_id, p_user_id, 'failed', v_order.status_v2::text, 'failed', p_reason, 'system');
END;
$$;

-- ── 9. RPC: admin_cancel_spot_order ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_cancel_spot_order(
  p_order_id uuid,
  p_reason   text DEFAULT 'admin_cancel'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_release_asset text;
  v_release_amt   numeric;
BEGIN
  IF (auth.jwt() ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.status NOT IN ('pending','open','partially_filled') THEN
    RAISE EXCEPTION 'Order cannot be cancelled in status %', v_order.status;
  END IF;

  v_release_asset := CASE WHEN v_order.side = 'buy' THEN v_order.quote_asset ELSE v_order.base_asset END;
  v_release_amt   := COALESCE(v_order.locked_amount, 0) *
                     (1 - COALESCE(v_order.filled_qty, 0) / NULLIF(v_order.quantity, 0));

  UPDATE orders SET status = 'cancelled', status_v2 = 'cancelled', updated_at = now()
  WHERE id = p_order_id;

  IF v_release_amt > 0 AND v_release_asset IS NOT NULL THEN
    UPDATE wallets SET
      available_balance = available_balance + v_release_amt,
      locked_balance    = GREATEST(0, locked_balance - v_release_amt),
      updated_at        = now()
    WHERE user_id = v_order.user_id AND asset = v_release_asset AND wallet_type = 'spot';

    INSERT INTO ledger_entries (user_id, asset, entry_type, credit, debit, reference_id, reference_type, description)
    VALUES (v_order.user_id, v_release_asset, 'lock_release', v_release_amt, 0,
            p_order_id, 'order', format('Admin cancel: released %s %s (%s)', v_release_amt, v_release_asset, p_reason));
  END IF;

  INSERT INTO order_audit_logs (order_id, user_id, event_type, old_status, new_status, released_amount, actor, metadata)
  VALUES (p_order_id, v_order.user_id, 'cancelled', v_order.status_v2::text, 'cancelled',
          v_release_amt, 'admin', jsonb_build_object('reason', p_reason));
END;
$$;

-- ── 10. Grants ────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.settle_binance_fill        TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_spot_order_provider TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_spot_order            TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_spot_order    TO authenticated;
