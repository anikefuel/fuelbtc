
-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 00049b: Futures Trading Engine v2
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. futures_funding_history table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS futures_funding_history (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id     uuid        REFERENCES positions(id) ON DELETE SET NULL,
  symbol          text        NOT NULL,
  side            text        NOT NULL,
  size            numeric     NOT NULL,
  mark_price      numeric     NOT NULL,
  funding_rate    numeric     NOT NULL,
  fee_amount      numeric     NOT NULL,
  asset           text        NOT NULL DEFAULT 'USDT',
  period_ts       timestamptz NOT NULL DEFAULT now(),
  idempotency_key text        UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE futures_funding_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_funding_hist" ON futures_funding_history
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "admin_all_funding_hist" ON futures_funding_history
  FOR ALL USING (
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── 2. futures_liquidation_events table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS futures_liquidation_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id     uuid        REFERENCES positions(id) ON DELETE SET NULL,
  user_id         uuid        NOT NULL,
  symbol          text        NOT NULL,
  side            text        NOT NULL,
  size            numeric     NOT NULL,
  entry_price     numeric     NOT NULL,
  liq_price       numeric     NOT NULL,
  mark_price      numeric     NOT NULL,
  realized_pnl    numeric     NOT NULL DEFAULT 0,
  liq_fee         numeric     NOT NULL DEFAULT 0,
  margin_returned numeric     NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'completed',
  provider_order_id text,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE futures_liquidation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_liq_events" ON futures_liquidation_events
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "admin_all_liq_events" ON futures_liquidation_events
  FOR ALL USING (
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── 3. Extend positions table ────────────────────────────────────────────────
ALTER TABLE positions ADD COLUMN IF NOT EXISTS provider_position_id text;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS provider_order_id    text;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS last_sync_at         timestamptz;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS risk_level           text NOT NULL DEFAULT 'normal';

-- ─── 4. Extend orders table ──────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS position_id       uuid REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS close_position_id uuid REFERENCES positions(id) ON DELETE SET NULL;

-- ─── 5. RPC: place_futures_order ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION place_futures_order(
  p_user_id         uuid,
  p_symbol          text,
  p_side            text,
  p_order_type      text,
  p_size            numeric,
  p_price           numeric,
  p_leverage        int,
  p_margin_mode     text,
  p_tp_price        numeric,
  p_sl_price        numeric,
  p_idempotency_key text,
  p_reduce_only     boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id     uuid;
  v_notional     numeric;
  v_init_margin  numeric;
  v_fee_rate     numeric := 0.0004;
  v_total_needed numeric;
  v_avail        numeric;
  v_side_enum    order_side;
BEGIN
  SELECT id INTO v_order_id FROM orders WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_order_id; END IF;

  IF p_leverage < 1 OR p_leverage > 125 THEN
    RAISE EXCEPTION 'Invalid leverage: %', p_leverage;
  END IF;
  IF p_price <= 0 THEN
    RAISE EXCEPTION 'price must be > 0';
  END IF;

  v_notional     := p_size * p_price;
  v_init_margin  := v_notional / p_leverage;
  v_total_needed := v_init_margin + (v_notional * v_fee_rate);

  IF NOT p_reduce_only THEN
    SELECT available_balance INTO v_avail
    FROM wallets
    WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures'
    FOR UPDATE;

    IF v_avail IS NULL OR v_avail < v_total_needed THEN
      RAISE EXCEPTION 'Insufficient futures margin: need %, have %',
        round(v_total_needed, 4), COALESCE(round(v_avail, 4), 0);
    END IF;

    UPDATE wallets SET
      available_balance = available_balance - v_init_margin,
      locked_balance    = locked_balance    + v_init_margin,
      updated_at        = now()
    WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures';
  END IF;

  v_side_enum := CASE p_side WHEN 'long' THEN 'buy'::order_side ELSE 'sell'::order_side END;

  INSERT INTO orders (
    user_id, symbol, side, order_type_v2, market_type_v2, status_v2,
    quantity, remaining_qty, price, notional, leverage_v2, margin_mode,
    tp_price, sl_price, locked_amount, reduce_only, idempotency_key,
    provider_name, metadata, created_at, updated_at
  ) VALUES (
    p_user_id, p_symbol, v_side_enum,
    p_order_type::order_type_v2,
    'futures'::market_type_enum,
    'pending'::order_status,
    p_size, p_size,
    CASE WHEN p_price > 0 THEN p_price ELSE NULL END,
    v_notional, p_leverage, p_margin_mode::margin_mode_enum,
    NULLIF(p_tp_price, 0), NULLIF(p_sl_price, 0),
    v_init_margin, p_reduce_only, p_idempotency_key,
    'binance',
    jsonb_build_object('position_side', p_side, 'margin_mode', p_margin_mode),
    now(), now()
  )
  RETURNING id INTO v_order_id;

  IF NOT p_reduce_only THEN
    INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_id, reference_type, description)
    VALUES (p_user_id, 'USDT', 'futures_margin_lock', v_init_margin, 0,
            v_order_id, 'futures_order',
            format('Margin locked: %s %s×%s %s', p_symbol, p_leverage, p_size, p_side));
  END IF;

  RETURN v_order_id;
END;
$$;

-- ─── 6. RPC: settle_futures_fill ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION settle_futures_fill(
  p_order_id          uuid,
  p_user_id           uuid,
  p_fill_qty          numeric,
  p_fill_price        numeric,
  p_fee               numeric,
  p_provider_order_id text,
  p_provider_fill_id  text,
  p_position_side     text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ord           orders%ROWTYPE;
  v_position_id   uuid;
  v_notional      numeric;
  v_init_margin   numeric;
  v_maint_margin  numeric;
  v_liq_price     numeric;
  v_new_filled    numeric;
  v_new_remaining numeric;
BEGIN
  SELECT * INTO v_ord FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  v_notional      := p_fill_qty * p_fill_price;
  v_init_margin   := v_notional / GREATEST(v_ord.leverage_v2, 1);
  v_maint_margin  := v_notional * 0.005;
  v_new_filled    := v_ord.filled_qty + p_fill_qty;
  v_new_remaining := GREATEST(0, v_ord.remaining_qty - p_fill_qty);

  IF p_position_side = 'long' THEN
    v_liq_price := p_fill_price * (1 - 1.0 / GREATEST(v_ord.leverage_v2, 1) + 0.005);
  ELSE
    v_liq_price := p_fill_price * (1 + 1.0 / GREATEST(v_ord.leverage_v2, 1) - 0.005);
  END IF;

  UPDATE orders SET
    filled_qty        = v_new_filled,
    remaining_qty     = v_new_remaining,
    avg_fill_price    = p_fill_price,
    fee               = fee + p_fee,
    status_v2         = CASE WHEN v_new_remaining <= 0 THEN 'filled' ELSE 'partially_filled' END::order_status,
    provider_order_id = p_provider_order_id,
    updated_at        = now()
  WHERE id = p_order_id;

  IF p_fee > 0 THEN
    UPDATE wallets SET
      available_balance = GREATEST(0, available_balance - p_fee),
      updated_at = now()
    WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures';

    INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_id, reference_type, description)
    VALUES (p_user_id, 'USDT', 'futures_trade_fee', p_fee, 0, p_order_id, 'futures_order',
            format('Futures fee: %s', v_ord.symbol));
  END IF;

  INSERT INTO positions (
    user_id, symbol, side, status, margin_mode, leverage,
    entry_price, mark_price, liq_price, size, notional,
    initial_margin, maint_margin, tp_price, sl_price,
    provider_name, provider_order_id
  ) VALUES (
    p_user_id, v_ord.symbol, p_position_side::position_side, 'open',
    v_ord.margin_mode::margin_mode_enum, v_ord.leverage_v2,
    p_fill_price, p_fill_price, v_liq_price,
    p_fill_qty, v_notional, v_init_margin, v_maint_margin,
    v_ord.tp_price, v_ord.sl_price,
    'binance', p_provider_order_id
  )
  ON CONFLICT (user_id, symbol, side, status) DO UPDATE SET
    size              = positions.size + p_fill_qty,
    notional          = positions.notional + v_notional,
    entry_price       = (positions.entry_price * positions.size + p_fill_price * p_fill_qty)
                        / (positions.size + p_fill_qty),
    mark_price        = p_fill_price,
    liq_price         = v_liq_price,
    initial_margin    = positions.initial_margin + v_init_margin,
    provider_order_id = p_provider_order_id,
    updated_at        = now()
  RETURNING id INTO v_position_id;

  UPDATE orders SET position_id = v_position_id WHERE id = p_order_id;

  INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_id, reference_type, description)
  VALUES (p_user_id, 'USDT', 'futures_trade_fill', 0, 0, v_position_id, 'futures_position',
          format('Fill: %s %s %.4f @ %.4f', v_ord.symbol, p_position_side, p_fill_qty, p_fill_price));

  RETURN v_position_id;
END;
$$;

-- ─── 7. RPC: cancel_futures_order ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_futures_order(
  p_order_id  uuid,
  p_user_id   uuid,
  p_reason    text DEFAULT 'user_cancelled'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ord     orders%ROWTYPE;
  v_release numeric;
BEGIN
  SELECT * INTO v_ord FROM orders
  WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_ord.status_v2 NOT IN ('pending','open','partially_filled') THEN
    RAISE EXCEPTION 'Order not cancellable (status: %)', v_ord.status_v2;
  END IF;

  UPDATE orders SET
    status_v2     = 'cancelled',
    reject_reason = p_reason,
    updated_at    = now()
  WHERE id = p_order_id;

  IF v_ord.locked_amount > 0 AND v_ord.quantity > 0 THEN
    v_release := v_ord.locked_amount * (v_ord.remaining_qty / v_ord.quantity);
    UPDATE wallets SET
      locked_balance    = GREATEST(0, locked_balance - v_release),
      available_balance = available_balance + v_release,
      updated_at        = now()
    WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures';

    INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_id, reference_type, description)
    VALUES (p_user_id, 'USDT', 'futures_margin_unlock', 0, v_release, p_order_id, 'futures_order',
            format('Margin released: cancelled %s', p_order_id));
  END IF;
END;
$$;

-- ─── 8. RPC: settle_futures_close ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION settle_futures_close(
  p_position_id       uuid,
  p_user_id           uuid,
  p_close_qty         numeric,
  p_close_price       numeric,
  p_fee               numeric,
  p_provider_order_id text,
  p_close_type        text DEFAULT 'user'
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pos           positions%ROWTYPE;
  v_pnl           numeric;
  v_return_margin numeric;
  v_close_qty     numeric;
BEGIN
  SELECT * INTO v_pos FROM positions
  WHERE id = p_position_id AND user_id = p_user_id AND status = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Position not found or already closed'; END IF;

  v_close_qty     := LEAST(p_close_qty, v_pos.size);
  v_return_margin := v_pos.initial_margin * (v_close_qty / v_pos.size);

  IF v_pos.side = 'long' THEN
    v_pnl := (p_close_price - v_pos.entry_price) * v_close_qty;
  ELSE
    v_pnl := (v_pos.entry_price - p_close_price) * v_close_qty;
  END IF;
  v_pnl := v_pnl - p_fee;

  IF v_close_qty >= v_pos.size THEN
    UPDATE positions SET
      status            = 'closed',
      realized_pnl      = realized_pnl + v_pnl,
      closed_at         = now(),
      updated_at        = now(),
      provider_order_id = p_provider_order_id
    WHERE id = p_position_id;

    INSERT INTO position_history (
      user_id, symbol, side, margin_mode, leverage,
      entry_price, close_price, size, realized_pnl, cum_funding_fee, close_type, opened_at
    ) VALUES (
      v_pos.user_id, v_pos.symbol, v_pos.side, v_pos.margin_mode, v_pos.leverage,
      v_pos.entry_price, p_close_price, v_close_qty,
      v_pos.realized_pnl + v_pnl, v_pos.cum_funding_fee, p_close_type, v_pos.opened_at
    );
  ELSE
    UPDATE positions SET
      size           = size - v_close_qty,
      notional       = notional * (1 - v_close_qty / v_pos.size),
      initial_margin = initial_margin * (1 - v_close_qty / v_pos.size),
      realized_pnl   = realized_pnl + v_pnl,
      updated_at     = now()
    WHERE id = p_position_id;
  END IF;

  UPDATE wallets SET
    locked_balance    = GREATEST(0, locked_balance    - v_return_margin),
    available_balance = available_balance + v_return_margin + v_pnl,
    updated_at        = now()
  WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures';

  INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_id, reference_type, description)
  VALUES
    (p_user_id, 'USDT', 'futures_margin_unlock', 0, v_return_margin, p_position_id, 'futures_position',
     format('Margin returned: %s %s', v_pos.symbol, p_close_type)),
    (p_user_id, 'USDT',
     CASE WHEN v_pnl >= 0 THEN 'futures_pnl_credit' ELSE 'futures_pnl_debit' END,
     CASE WHEN v_pnl < 0 THEN ABS(v_pnl) ELSE 0 END,
     CASE WHEN v_pnl >= 0 THEN v_pnl ELSE 0 END,
     p_position_id, 'futures_position',
     format('Realized PnL: %s %s @ %.4f', v_pos.symbol, round(v_pnl,4), p_close_price));

  RETURN v_pnl;
END;
$$;

-- ─── 9. RPC: add_futures_margin ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION add_futures_margin(
  p_position_id uuid,
  p_user_id     uuid,
  p_amount      numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_avail numeric;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  SELECT available_balance INTO v_avail
  FROM wallets WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures'
  FOR UPDATE;
  IF v_avail IS NULL OR v_avail < p_amount THEN
    RAISE EXCEPTION 'Insufficient futures balance: need %, have %', p_amount, COALESCE(v_avail, 0);
  END IF;

  UPDATE wallets SET
    available_balance = available_balance - p_amount,
    locked_balance    = locked_balance    + p_amount,
    updated_at        = now()
  WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures';

  UPDATE positions SET
    initial_margin = initial_margin + p_amount,
    updated_at     = now()
  WHERE id = p_position_id AND user_id = p_user_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Position not found'; END IF;

  INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_id, reference_type, description)
  VALUES (p_user_id, 'USDT', 'futures_margin_add', p_amount, 0, p_position_id, 'futures_position',
          format('Margin added: %s USDT', p_amount));
END;
$$;

-- ─── 10. RPC: reduce_futures_margin ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION reduce_futures_margin(
  p_position_id uuid,
  p_user_id     uuid,
  p_amount      numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pos        positions%ROWTYPE;
  v_min_margin numeric;
BEGIN
  SELECT * INTO v_pos FROM positions
  WHERE id = p_position_id AND user_id = p_user_id AND status = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Position not found'; END IF;

  v_min_margin := v_pos.maint_margin * 1.1;
  IF v_pos.initial_margin - p_amount < v_min_margin THEN
    RAISE EXCEPTION 'Cannot reduce: would breach maintenance margin (min: %)', round(v_min_margin, 4);
  END IF;

  UPDATE positions SET
    initial_margin = initial_margin - p_amount,
    updated_at     = now()
  WHERE id = p_position_id AND user_id = p_user_id;

  UPDATE wallets SET
    locked_balance    = GREATEST(0, locked_balance    - p_amount),
    available_balance = available_balance + p_amount,
    updated_at        = now()
  WHERE user_id = p_user_id AND asset = 'USDT' AND wallet_type = 'futures';

  INSERT INTO ledger_entries (user_id, asset, entry_type, debit, credit, reference_id, reference_type, description)
  VALUES (p_user_id, 'USDT', 'futures_margin_reduce', 0, p_amount, p_position_id, 'futures_position',
          format('Margin reduced: %s USDT', p_amount));
END;
$$;

-- ─── 11. RPC: futures_admin_force_close ──────────────────────────────────────
CREATE OR REPLACE FUNCTION futures_admin_force_close(
  p_position_id uuid,
  p_admin_id    uuid,
  p_close_price numeric,
  p_reason      text DEFAULT 'admin_forced'
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pos positions%ROWTYPE;
  v_pnl numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_pos FROM positions WHERE id = p_position_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Position not open'; END IF;

  v_pnl := settle_futures_close(
    p_position_id, v_pos.user_id, v_pos.size,
    p_close_price, 0, 'admin_force_' || p_admin_id::text, p_reason
  );

  INSERT INTO wallet_audit_logs (actor_id, target_user_id, action, asset, amount, reference_type, reason)
  VALUES (p_admin_id, v_pos.user_id, 'admin_force_close_futures',
          'USDT', ABS(v_pnl), 'futures_position', p_reason);

  RETURN v_pnl;
END;
$$;

-- ─── 12. RPC: update_position_risk_level ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_position_risk_level(
  p_position_id uuid,
  p_mark_price  numeric,
  p_risk_level  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE positions SET
    mark_price  = p_mark_price,
    risk_level  = p_risk_level,
    updated_at  = now()
  WHERE id = p_position_id;
END;
$$;

-- ─── 13. Trading settings ─────────────────────────────────────────────────────
INSERT INTO trading_settings (key, value, description)
VALUES ('futures_trading_enabled', 'true'::jsonb, 'Enable/disable futures trading globally')
ON CONFLICT (key) DO NOTHING;

INSERT INTO trading_settings (key, value, description)
VALUES ('futures_max_leverage', '125'::jsonb, 'Global maximum leverage cap')
ON CONFLICT (key) DO NOTHING;

INSERT INTO trading_settings (key, value, description)
VALUES ('futures_liquidation_fee', '0.0125'::jsonb, 'Liquidation fee rate (1.25%)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO trading_settings (key, value, description)
VALUES ('futures_paused', 'false'::jsonb, 'Emergency pause for futures')
ON CONFLICT (key) DO NOTHING;

-- ─── 14. pg_cron schedules ────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('futures-liquidation-monitor');
EXCEPTION WHEN others THEN NULL;
END;
$$;
SELECT cron.schedule('futures-liquidation-monitor', '* * * * *', 'SELECT 1');

DO $$
BEGIN
  PERFORM cron.unschedule('futures-funding-settle');
EXCEPTION WHEN others THEN NULL;
END;
$$;
SELECT cron.schedule('futures-funding-settle', '0 0,8,16 * * *', 'SELECT 1');
