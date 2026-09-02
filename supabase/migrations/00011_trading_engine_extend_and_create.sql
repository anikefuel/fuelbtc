
-- ═══════════════════════════════════════════════════════════════════
-- TRADING ENGINE — extend existing tables + create missing ones
-- ═══════════════════════════════════════════════════════════════════

-- ── New enums (only ones not already existing) ───────────────────
CREATE TYPE order_type_enum  AS ENUM (
  'market','limit','stop_market','stop_limit',
  'take_profit_market','take_profit_limit','stop_loss','oco','trailing_stop'
);
CREATE TYPE market_type_enum AS ENUM ('spot','futures','margin');
CREATE TYPE time_in_force    AS ENUM ('GTC','IOC','FOK','GTX');
CREATE TYPE margin_mode_enum AS ENUM ('cross','isolated');
CREATE TYPE position_side    AS ENUM ('long','short');
CREATE TYPE position_status  AS ENUM ('open','closed','liquidated');
CREATE TYPE pair_status      AS ENUM ('active','suspended','maintenance');

-- ── Extend orders table ──────────────────────────────────────────
-- Add columns that don't exist yet (all nullable to avoid constraint issues)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS base_asset       text,
  ADD COLUMN IF NOT EXISTS quote_asset      text,
  ADD COLUMN IF NOT EXISTS order_type_v2    order_type_enum,
  ADD COLUMN IF NOT EXISTS status_v2        order_status DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS market_type_v2   market_type_enum NOT NULL DEFAULT 'spot',
  ADD COLUMN IF NOT EXISTS trigger_price    numeric(30,10),
  ADD COLUMN IF NOT EXISTS remaining_qty    numeric(30,10) GENERATED ALWAYS AS (quantity - filled_qty) STORED,
  ADD COLUMN IF NOT EXISTS notional         numeric(30,10),
  ADD COLUMN IF NOT EXISTS leverage_v2      int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS margin_mode      margin_mode_enum NOT NULL DEFAULT 'cross',
  ADD COLUMN IF NOT EXISTS reduce_only      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS post_only        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_in_force_v2 time_in_force NOT NULL DEFAULT 'GTC',
  ADD COLUMN IF NOT EXISTS tp_price         numeric(30,10),
  ADD COLUMN IF NOT EXISTS sl_price         numeric(30,10),
  ADD COLUMN IF NOT EXISTS locked_amount    numeric(30,10) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_name    text DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS reject_reason    text,
  ADD COLUMN IF NOT EXISTS metadata         jsonb DEFAULT '{}';

-- Extend trading_pairs ─────────────────────────────────────────────
ALTER TABLE trading_pairs
  ADD COLUMN IF NOT EXISTS status_v2        pair_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS min_notional     numeric(20,8) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_leverage     int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_precision  int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS qty_precision    int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS is_margin_ok     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_futures_ok    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_symbol  text,
  ADD COLUMN IF NOT EXISTS sort_order       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_type_v2   market_type_enum NOT NULL DEFAULT 'spot';

-- Extend api_keys ──────────────────────────────────────────────────
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS can_read         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_trade        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_withdraw     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rate_limit_per_min int NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS label_v2         text;

-- ── Create missing tables ─────────────────────────────────────────

-- leverage_brackets
CREATE TABLE leverage_brackets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          text NOT NULL,
  bracket         int NOT NULL,
  initial_leverage int NOT NULL,
  notional_cap    numeric(20,2) NOT NULL,
  notional_floor  numeric(20,2) NOT NULL DEFAULT 0,
  maint_margin_rate numeric(10,6) NOT NULL,
  cum_fast_out_amount numeric(20,4) NOT NULL DEFAULT 0,
  UNIQUE(symbol, bracket)
);

-- order_fills
CREATE TABLE order_fills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  symbol          text NOT NULL,
  side            order_side NOT NULL,
  fill_price      numeric(30,10) NOT NULL,
  fill_qty        numeric(30,10) NOT NULL,
  fill_notional   numeric(30,10) NOT NULL,
  fee             numeric(30,10) NOT NULL DEFAULT 0,
  fee_asset       text,
  is_maker        boolean NOT NULL DEFAULT false,
  trade_id        uuid,
  provider_trade_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fills_order_id  ON order_fills(order_id);
CREATE INDEX idx_fills_user_id   ON order_fills(user_id);
CREATE INDEX idx_fills_symbol    ON order_fills(symbol);
CREATE INDEX idx_fills_created   ON order_fills(created_at DESC);

-- trades
CREATE TABLE trades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          text NOT NULL,
  market_type     market_type_enum NOT NULL DEFAULT 'spot',
  buyer_order_id  uuid REFERENCES orders(id),
  seller_order_id uuid REFERENCES orders(id),
  buyer_id        uuid REFERENCES auth.users(id),
  seller_id       uuid REFERENCES auth.users(id),
  price           numeric(30,10) NOT NULL,
  quantity        numeric(30,10) NOT NULL,
  notional        numeric(30,10) NOT NULL,
  buyer_fee       numeric(30,10) NOT NULL DEFAULT 0,
  seller_fee      numeric(30,10) NOT NULL DEFAULT 0,
  is_buyer_maker  boolean NOT NULL DEFAULT false,
  provider_trade_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trades_symbol     ON trades(symbol);
CREATE INDEX idx_trades_buyer_id   ON trades(buyer_id);
CREATE INDEX idx_trades_seller_id  ON trades(seller_id);
CREATE INDEX idx_trades_created    ON trades(created_at DESC);

-- positions
CREATE TABLE positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  symbol          text NOT NULL,
  side            position_side NOT NULL,
  status          position_status NOT NULL DEFAULT 'open',
  margin_mode     margin_mode_enum NOT NULL DEFAULT 'cross',
  leverage        int NOT NULL DEFAULT 10,
  entry_price     numeric(30,10) NOT NULL,
  mark_price      numeric(30,10),
  liq_price       numeric(30,10),
  size            numeric(30,10) NOT NULL,
  notional        numeric(30,10) NOT NULL,
  initial_margin  numeric(30,10) NOT NULL,
  maint_margin    numeric(30,10) NOT NULL DEFAULT 0,
  margin_ratio    numeric(10,6),
  unrealized_pnl  numeric(30,10) NOT NULL DEFAULT 0,
  realized_pnl    numeric(30,10) NOT NULL DEFAULT 0,
  cum_funding_fee numeric(30,10) NOT NULL DEFAULT 0,
  tp_price        numeric(30,10),
  sl_price        numeric(30,10),
  adl_quantile    int,
  provider_name   text DEFAULT 'internal',
  metadata        jsonb DEFAULT '{}',
  opened_at       timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_symbol  ON positions(symbol);
CREATE INDEX idx_positions_status  ON positions(status);

-- position_history
CREATE TABLE position_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  symbol          text NOT NULL,
  side            position_side NOT NULL,
  margin_mode     margin_mode_enum NOT NULL,
  leverage        int NOT NULL,
  entry_price     numeric(30,10) NOT NULL,
  close_price     numeric(30,10) NOT NULL,
  size            numeric(30,10) NOT NULL,
  realized_pnl    numeric(30,10) NOT NULL,
  cum_funding_fee numeric(30,10) NOT NULL DEFAULT 0,
  close_type      text NOT NULL DEFAULT 'user',
  opened_at       timestamptz NOT NULL,
  closed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pos_hist_user   ON position_history(user_id);
CREATE INDEX idx_pos_hist_symbol ON position_history(symbol);
CREATE INDEX idx_pos_hist_closed ON position_history(closed_at DESC);

-- funding_rates
CREATE TABLE funding_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          text NOT NULL,
  funding_rate    numeric(20,10) NOT NULL,
  next_funding_time timestamptz NOT NULL,
  mark_price      numeric(30,10),
  index_price     numeric(30,10),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_funding_symbol ON funding_rates(symbol, recorded_at DESC);

-- funding_payments
CREATE TABLE funding_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  position_id     uuid NOT NULL REFERENCES positions(id),
  symbol          text NOT NULL,
  side            position_side NOT NULL,
  funding_rate    numeric(20,10) NOT NULL,
  size            numeric(30,10) NOT NULL,
  payment_amount  numeric(30,10) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_funding_pay_user ON funding_payments(user_id);
CREATE INDEX idx_funding_pay_pos  ON funding_payments(position_id);

-- liquidations
CREATE TABLE liquidations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  position_id     uuid NOT NULL REFERENCES positions(id),
  symbol          text NOT NULL,
  side            position_side NOT NULL,
  liquidation_price numeric(30,10) NOT NULL,
  mark_price_at_liq numeric(30,10) NOT NULL,
  size            numeric(30,10) NOT NULL,
  initial_margin  numeric(30,10) NOT NULL,
  maint_margin    numeric(30,10) NOT NULL,
  pnl_loss        numeric(30,10) NOT NULL,
  liq_fee         numeric(30,10) NOT NULL DEFAULT 0,
  insurance_fund  numeric(30,10) NOT NULL DEFAULT 0,
  close_order_id  uuid REFERENCES orders(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_liq_user_id ON liquidations(user_id);
CREATE INDEX idx_liq_created ON liquidations(created_at DESC);

-- trading_fees
CREATE TABLE trading_fees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_type     market_type_enum NOT NULL DEFAULT 'spot',
  vip_level       int NOT NULL DEFAULT 0,
  maker_fee       numeric(10,6) NOT NULL DEFAULT 0.001,
  taker_fee       numeric(10,6) NOT NULL DEFAULT 0.001,
  funding_fee_rate numeric(10,6) NOT NULL DEFAULT 0.0001,
  liquidation_fee numeric(10,6) NOT NULL DEFAULT 0.005,
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE(market_type, vip_level)
);

-- provider_orders
CREATE TABLE provider_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  provider_name   text NOT NULL DEFAULT 'binance',
  provider_order_id text NOT NULL,
  provider_symbol text NOT NULL,
  provider_status text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}',
  response_payload jsonb NOT NULL DEFAULT '{}',
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prov_orders_order_id ON provider_orders(order_id);
CREATE INDEX idx_prov_orders_provider ON provider_orders(provider_name, provider_order_id);

-- trading_settings
CREATE TABLE trading_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- risk_events
CREATE TABLE risk_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id),
  event_type  text NOT NULL,
  symbol      text,
  severity    text NOT NULL DEFAULT 'medium',
  details     jsonb NOT NULL DEFAULT '{}',
  is_resolved boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_events_user    ON risk_events(user_id);
CREATE INDEX idx_risk_events_created ON risk_events(created_at DESC);

-- market_data_cache
CREATE TABLE market_data_cache (
  symbol          text PRIMARY KEY,
  market_type     market_type_enum NOT NULL DEFAULT 'spot',
  price           numeric(30,10) NOT NULL DEFAULT 0,
  price_change    numeric(20,8) NOT NULL DEFAULT 0,
  price_change_pct numeric(10,4) NOT NULL DEFAULT 0,
  high_24h        numeric(30,10) NOT NULL DEFAULT 0,
  low_24h         numeric(30,10) NOT NULL DEFAULT 0,
  volume_24h      numeric(30,10) NOT NULL DEFAULT 0,
  quote_volume_24h numeric(30,10) NOT NULL DEFAULT 0,
  open_interest   numeric(30,10),
  mark_price      numeric(30,10),
  index_price     numeric(30,10),
  funding_rate    numeric(20,10),
  next_funding_time timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- margin_accounts
CREATE TABLE margin_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  symbol       text NOT NULL,
  margin_mode  margin_mode_enum NOT NULL DEFAULT 'cross',
  leverage     int NOT NULL DEFAULT 10,
  isolated_margin numeric(30,10) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, symbol)
);
CREATE INDEX idx_margin_user ON margin_accounts(user_id);

-- ── RLS for new tables ────────────────────────────────────────────
ALTER TABLE leverage_brackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_fills       ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades            ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_rates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_fees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_data_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE margin_accounts   ENABLE ROW LEVEL SECURITY;

-- leverage_brackets: public read
CREATE POLICY "lev_brackets_read"  ON leverage_brackets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lev_brackets_admin" ON leverage_brackets FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- order_fills: user + admin
CREATE POLICY "fills_user_select"  ON order_fills FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "fills_admin_all"    ON order_fills FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- trades: participant + admin
CREATE POLICY "trades_participant"  ON trades FOR SELECT TO authenticated USING (buyer_id = auth.uid() OR seller_id = auth.uid());
CREATE POLICY "trades_admin_all"    ON trades FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- positions
CREATE POLICY "pos_user_select"   ON positions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "pos_user_insert"   ON positions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "pos_user_update"   ON positions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "pos_admin_all"     ON positions FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- position_history
CREATE POLICY "pos_hist_user"     ON position_history FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "pos_hist_admin"    ON position_history FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- funding_rates: public read
CREATE POLICY "fr_read"   ON funding_rates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "fr_admin"  ON funding_rates FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- funding_payments
CREATE POLICY "fp_user"   ON funding_payments FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "fp_admin"  ON funding_payments FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- liquidations
CREATE POLICY "liq_user"  ON liquidations FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "liq_admin" ON liquidations FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- trading_fees: public read
CREATE POLICY "tf_read"  ON trading_fees FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "tf_admin" ON trading_fees FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- provider_orders
CREATE POLICY "po_user"  ON provider_orders FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM orders o WHERE o.id = provider_orders.order_id AND o.user_id = auth.uid())
);
CREATE POLICY "po_admin" ON provider_orders FOR ALL TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- trading_settings: public read
CREATE POLICY "ts_read"  ON trading_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ts_admin" ON trading_settings FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- risk_events
CREATE POLICY "re_user"  ON risk_events FOR SELECT TO authenticated USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "re_admin" ON risk_events FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- market_data_cache: public read
CREATE POLICY "mdc_read"  ON market_data_cache FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "mdc_admin" ON market_data_cache FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- margin_accounts
CREATE POLICY "ma_user_select" ON margin_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "ma_user_insert" ON margin_accounts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ma_user_update" ON margin_accounts FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "ma_admin"       ON margin_accounts FOR ALL    TO authenticated USING (auth.jwt()->>'role'='admin') WITH CHECK (auth.jwt()->>'role'='admin');

-- ── Atomic RPC: place_spot_order ──────────────────────────────────
CREATE OR REPLACE FUNCTION place_spot_order(
  p_symbol       text,
  p_base_asset   text,
  p_quote_asset  text,
  p_side         order_side,
  p_order_type   text,
  p_quantity     numeric,
  p_price        numeric DEFAULT NULL,
  p_stop_price   numeric DEFAULT NULL,
  p_tif          text    DEFAULT 'GTC',
  p_client_oid   text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_lock_asset text;
  v_lock_amount numeric;
  v_wallet_id uuid;
  v_avail numeric;
  v_fee_rate numeric := 0.001;
  v_exec_price numeric;
BEGIN
  -- Determine lock asset and amount
  IF p_side = 'buy' THEN
    v_lock_asset := p_quote_asset;
    v_exec_price := COALESCE(p_price, 0);
    v_lock_amount := p_quantity * v_exec_price * (1 + v_fee_rate);
  ELSE
    v_lock_asset := p_base_asset;
    v_lock_amount := p_quantity * (1 + v_fee_rate);
  END IF;

  -- For market orders with no price provided, skip balance check (will be done at execution)
  IF p_order_type = 'market' AND v_exec_price = 0 THEN
    v_lock_amount := 0;
  END IF;

  -- Check balance if lock needed
  IF v_lock_amount > 0 THEN
    SELECT id, available_balance INTO v_wallet_id, v_avail
    FROM wallets WHERE user_id = v_user_id AND asset = v_lock_asset AND wallet_type = 'spot';
    IF NOT FOUND OR v_avail < v_lock_amount THEN
      RAISE EXCEPTION 'Insufficient balance: need % %, have %', v_lock_amount, v_lock_asset, COALESCE(v_avail, 0);
    END IF;
  END IF;

  -- Insert order
  INSERT INTO orders (
    user_id, symbol, base_asset, quote_asset, side, order_type,
    market_type_v2, status_v2, price, stop_price, quantity,
    time_in_force_v2, locked_amount, client_order_id, provider_name
  ) VALUES (
    v_user_id, p_symbol, p_base_asset, p_quote_asset, p_side, p_order_type::order_type_enum,
    'spot', 'pending', p_price, p_stop_price, p_quantity,
    p_tif::time_in_force, v_lock_amount, p_client_oid, 'internal'
  ) RETURNING id INTO v_order_id;

  -- Lock balance
  IF v_lock_amount > 0 AND v_wallet_id IS NOT NULL THEN
    UPDATE wallets
    SET available_balance = available_balance - v_lock_amount,
        locked_balance    = locked_balance    + v_lock_amount,
        updated_at        = now()
    WHERE id = v_wallet_id;

    INSERT INTO ledger_entries (account_id, entry_type, amount, asset, reference_id, description)
    SELECT la.id, 'lock', v_lock_amount, v_lock_asset, v_order_id, 'Order lock ' || p_side || ' ' || p_symbol
    FROM ledger_accounts la WHERE la.user_id = v_user_id AND la.asset = v_lock_asset LIMIT 1;
  END IF;

  RETURN v_order_id;
END;
$$;

-- ── Atomic RPC: execute_spot_fill ────────────────────────────────
CREATE OR REPLACE FUNCTION execute_spot_fill(
  p_order_id   uuid,
  p_fill_price numeric,
  p_fill_qty   numeric,
  p_is_maker   boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order     orders%ROWTYPE;
  v_fee_rate  numeric;
  v_fee       numeric;
  v_new_filled numeric;
  v_new_status order_status;
  v_base_wallet_id uuid;
  v_quote_wallet_id uuid;
  v_receive_asset text;
  v_receive_amt   numeric;
  v_deduct_asset  text;
  v_deduct_amt    numeric;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  -- Fee
  v_fee_rate := CASE WHEN p_is_maker THEN 0.001 ELSE 0.001 END;
  v_fee := p_fill_qty * p_fill_price * v_fee_rate;

  v_new_filled := v_order.filled_qty + p_fill_qty;
  v_new_status := CASE
    WHEN v_new_filled >= v_order.quantity THEN 'filled'
    ELSE 'partially_filled'
  END;

  -- Update order
  UPDATE orders SET
    filled_qty     = v_new_filled,
    avg_fill_price = (COALESCE(avg_fill_price,0)*filled_qty + p_fill_price*p_fill_qty) / v_new_filled,
    fee            = fee + v_fee,
    status         = v_new_status,
    status_v2      = v_new_status,
    updated_at     = now()
  WHERE id = p_order_id;

  -- Record fill
  INSERT INTO order_fills(order_id, user_id, symbol, side, fill_price, fill_qty, fill_notional, fee, fee_asset, is_maker)
  SELECT p_order_id, v_order.user_id, v_order.symbol, v_order.side,
         p_fill_price, p_fill_qty, p_fill_qty*p_fill_price, v_fee,
         CASE WHEN v_order.side='buy' THEN v_order.base_asset ELSE v_order.quote_asset END,
         p_is_maker;

  -- Credit/debit wallets
  IF v_order.side = 'buy' THEN
    v_receive_asset := v_order.base_asset;
    v_receive_amt   := p_fill_qty - v_fee;
    v_deduct_asset  := v_order.quote_asset;
    v_deduct_amt    := p_fill_qty * p_fill_price; -- already locked
  ELSE
    v_receive_asset := v_order.quote_asset;
    v_receive_amt   := p_fill_qty * p_fill_price - v_fee;
    v_deduct_asset  := v_order.base_asset;
    v_deduct_amt    := p_fill_qty; -- already locked
  END IF;

  -- Debit locked balance of spent asset
  UPDATE wallets SET locked_balance = locked_balance - v_deduct_amt, updated_at = now()
  WHERE user_id = v_order.user_id AND asset = v_deduct_asset AND wallet_type = 'spot';

  -- Credit received asset
  UPDATE wallets SET available_balance = available_balance + v_receive_amt, updated_at = now()
  WHERE user_id = v_order.user_id AND asset = v_receive_asset AND wallet_type = 'spot';

  -- If it didn't exist, create the spot wallet
  INSERT INTO wallets(user_id, wallet_type, asset, balance, available_balance, locked_balance)
  VALUES (v_order.user_id, 'spot', v_receive_asset, v_receive_amt, v_receive_amt, 0)
  ON CONFLICT DO NOTHING;
END;
$$;

-- ── Atomic RPC: cancel_order_release ─────────────────────────────
CREATE OR REPLACE FUNCTION cancel_order_release(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_release_asset text;
  v_release_amt numeric;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found or not owned'; END IF;
  IF v_order.status NOT IN ('pending','open','partially_filled') THEN
    RAISE EXCEPTION 'Order cannot be cancelled in status %', v_order.status;
  END IF;

  v_release_asset := CASE WHEN v_order.side = 'buy' THEN v_order.quote_asset ELSE v_order.base_asset END;
  -- Release only unfilled portion
  v_release_amt := v_order.locked_amount * (1 - v_order.filled_qty / v_order.quantity);

  UPDATE orders SET status = 'cancelled', status_v2 = 'cancelled', updated_at = now() WHERE id = p_order_id;

  IF v_release_amt > 0 AND v_release_asset IS NOT NULL THEN
    UPDATE wallets
    SET available_balance = available_balance + v_release_amt,
        locked_balance    = GREATEST(0, locked_balance - v_release_amt),
        updated_at = now()
    WHERE user_id = v_order.user_id AND asset = v_release_asset AND wallet_type = 'spot';
  END IF;
END;
$$;

-- ── Atomic RPC: open_futures_position ────────────────────────────
CREATE OR REPLACE FUNCTION open_futures_position(
  p_symbol      text,
  p_side        position_side,
  p_size        numeric,
  p_entry_price numeric,
  p_leverage    int,
  p_margin_mode margin_mode_enum DEFAULT 'cross',
  p_tp_price    numeric DEFAULT NULL,
  p_sl_price    numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_position_id  uuid;
  v_notional     numeric;
  v_init_margin  numeric;
  v_maint_margin numeric;
  v_liq_price    numeric;
  v_wallet_id    uuid;
  v_avail        numeric;
BEGIN
  v_notional    := p_size * p_entry_price;
  v_init_margin := v_notional / p_leverage;
  v_maint_margin := v_notional * 0.005; -- 0.5% maintenance

  -- Liquidation price calculation
  IF p_side = 'long' THEN
    v_liq_price := p_entry_price * (1 - 1.0/p_leverage + 0.005);
  ELSE
    v_liq_price := p_entry_price * (1 + 1.0/p_leverage - 0.005);
  END IF;

  -- Check USDT balance
  SELECT id, available_balance INTO v_wallet_id, v_avail
  FROM wallets WHERE user_id = v_user_id AND asset = 'USDT' AND wallet_type = 'futures';

  IF NOT FOUND OR v_avail < v_init_margin THEN
    RAISE EXCEPTION 'Insufficient futures margin: need %, have %', v_init_margin, COALESCE(v_avail,0);
  END IF;

  -- Lock margin
  UPDATE wallets SET
    available_balance = available_balance - v_init_margin,
    locked_balance    = locked_balance    + v_init_margin,
    updated_at        = now()
  WHERE id = v_wallet_id;

  -- Upsert position (merge if same symbol+side+open)
  INSERT INTO positions (
    user_id, symbol, side, status, margin_mode, leverage,
    entry_price, mark_price, liq_price, size, notional,
    initial_margin, maint_margin, tp_price, sl_price
  ) VALUES (
    v_user_id, p_symbol, p_side, 'open', p_margin_mode, p_leverage,
    p_entry_price, p_entry_price, v_liq_price, p_size, v_notional,
    v_init_margin, v_maint_margin, p_tp_price, p_sl_price
  )
  ON CONFLICT (user_id, symbol, side, status) DO UPDATE SET
    size           = positions.size + EXCLUDED.size,
    notional       = positions.notional + EXCLUDED.notional,
    entry_price    = (positions.entry_price * positions.size + EXCLUDED.entry_price * EXCLUDED.size)
                     / (positions.size + EXCLUDED.size),
    initial_margin = positions.initial_margin + EXCLUDED.initial_margin,
    liq_price      = EXCLUDED.liq_price,
    updated_at     = now()
  RETURNING id INTO v_position_id;

  RETURN v_position_id;
END;
$$;

-- ── Atomic RPC: close_futures_position ───────────────────────────
CREATE OR REPLACE FUNCTION close_futures_position(
  p_position_id uuid,
  p_close_price numeric,
  p_close_size  numeric DEFAULT NULL -- NULL = full close
) RETURNS numeric  -- returns realized PnL
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pos         positions%ROWTYPE;
  v_user_id     uuid := auth.uid();
  v_close_size  numeric;
  v_pnl         numeric;
  v_return_margin numeric;
BEGIN
  SELECT * INTO v_pos FROM positions WHERE id = p_position_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Position not found'; END IF;
  IF v_pos.status != 'open' THEN RAISE EXCEPTION 'Position already closed'; END IF;

  v_close_size := COALESCE(p_close_size, v_pos.size);
  IF v_close_size > v_pos.size THEN v_close_size := v_pos.size; END IF;

  -- PnL
  IF v_pos.side = 'long' THEN
    v_pnl := (p_close_price - v_pos.entry_price) * v_close_size;
  ELSE
    v_pnl := (v_pos.entry_price - p_close_price) * v_close_size;
  END IF;

  v_return_margin := v_pos.initial_margin * (v_close_size / v_pos.size);

  IF v_close_size >= v_pos.size THEN
    -- Full close
    UPDATE positions SET
      status = 'closed', realized_pnl = realized_pnl + v_pnl,
      closed_at = now(), updated_at = now()
    WHERE id = p_position_id;

    INSERT INTO position_history(user_id, symbol, side, margin_mode, leverage,
      entry_price, close_price, size, realized_pnl, cum_funding_fee, close_type, opened_at)
    VALUES(v_pos.user_id, v_pos.symbol, v_pos.side, v_pos.margin_mode, v_pos.leverage,
      v_pos.entry_price, p_close_price, v_close_size, v_pnl, v_pos.cum_funding_fee, 'user', v_pos.opened_at);
  ELSE
    -- Partial close
    UPDATE positions SET
      size = size - v_close_size,
      notional = notional * (1 - v_close_size/v_pos.size),
      initial_margin = initial_margin * (1 - v_close_size/v_pos.size),
      realized_pnl = realized_pnl + v_pnl,
      updated_at = now()
    WHERE id = p_position_id;
  END IF;

  -- Return margin + PnL to futures wallet
  UPDATE wallets SET
    locked_balance    = GREATEST(0, locked_balance - v_return_margin),
    available_balance = available_balance + v_return_margin + v_pnl,
    updated_at = now()
  WHERE user_id = v_user_id AND asset = 'USDT' AND wallet_type = 'futures';

  RETURN v_pnl;
END;
$$;

-- ── Atomic RPC: get_or_create_futures_wallet ──────────────────────
CREATE OR REPLACE FUNCTION get_or_create_futures_wallet(p_asset text DEFAULT 'USDT')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM wallets WHERE user_id = auth.uid() AND asset = p_asset AND wallet_type = 'futures';
  IF NOT FOUND THEN
    INSERT INTO wallets(user_id, wallet_type, asset, balance, available_balance, locked_balance)
    VALUES(auth.uid(), 'futures', p_asset, 0, 0, 0) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
